import * as core from '@actions/core'
import * as github from '@actions/github'
import {ZipArchive} from 'archiver'
import {createHash} from 'crypto'
import {createReadStream, createWriteStream, openAsBlob} from 'fs'
import {mkdir, mkdtemp, rm, stat} from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {Readable} from 'stream'
import {pipeline} from 'stream/promises'
import {ProxyAgent, fetch as undiciFetch} from 'undici'
import unzip from 'unzip-stream'
import {UTApi, UTFile} from 'uploadthing/server'
import type {
  UploadThingAcl,
  UploadThingContentDisposition,
  UploadThingInputs
} from './uploadthing-input-helper.js'

export interface UploadArtifactOptions extends UploadThingInputs {
  retentionDays?: number
  compressionLevel?: number
  archive: boolean
  overwrite?: boolean
}

export interface StoredArtifact {
  name: string
  key: string
  customId: string
  fileName: string
  size: number
  archive: boolean
}

type UploadThingFile = {
  key?: string
  fileKey?: string
  name?: string
  fileName?: string
  size?: number
  customId?: string | null
  ufsUrl?: string
  url?: string
  appUrl?: string
}

type UploadThingPage = {
  hasMore?: boolean
  files?: readonly UploadThingFile[]
  data?:
    | {hasMore?: boolean; files?: readonly UploadThingFile[]}
    | readonly UploadThingFile[]
}

type PreparedArtifactFile = {
  artifactName: string
  fileName: string
  filePath: string
  archive: boolean
  cleanupDirectory?: string
}

const maxCustomIdLength = 128
const listFilesLimit = 500
const artifactPrefix = 'gha'

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString()
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function runScope(): string {
  const repository = `${github.context.repo.owner}/${github.context.repo.repo}`
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1'
  return sha256Text(`${repository}:${github.context.runId}:${attempt}`).slice(
    0,
    16
  )
}

function runCustomIdPrefix(): string {
  return `${artifactPrefix}_${runScope()}_`
}

function artifactCustomId(artifactName: string, archive: boolean): string {
  const customId = `${runCustomIdPrefix()}${archive ? 'a' : 'f'}_${base64Url(
    artifactName
  )}`
  if (customId.length > maxCustomIdLength) {
    throw new Error(
      `UploadThing customId is ${customId.length} characters; maximum is ${maxCustomIdLength}. Use a shorter artifact name.`
    )
  }
  return customId
}

function customIdParts(customId: string): [string, string] | undefined {
  const prefix = runCustomIdPrefix()
  if (!customId.startsWith(prefix)) {
    return undefined
  }

  const value = customId.slice(prefix.length)
  const archiveFlag = value[0]
  const encodedName = value.slice(2)
  return value[1] === '_' && encodedName && ['a', 'f'].includes(archiveFlag)
    ? [archiveFlag, encodedName]
    : undefined
}

function parseArtifact(
  customId: string,
  file: UploadThingFile
): StoredArtifact | undefined {
  const parts = customIdParts(customId)
  const key = file.key || file.fileKey
  if (!parts || !key) {
    return undefined
  }

  const [archiveFlag, encodedName] = parts
  return {
    name: fromBase64Url(encodedName),
    key,
    customId,
    fileName: file.name || file.fileName || '',
    size: file.size || 0,
    archive: archiveFlag === 'a'
  }
}

function proxyUrl(): string | undefined {
  return (
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY
  )
}

function proxyFetch(): typeof fetch | undefined {
  const url = proxyUrl()
  if (!url) {
    return undefined
  }

  const dispatcher = new ProxyAgent(url)
  return (input, init) =>
    undiciFetch(input as any, {...init, dispatcher} as any) as any
}

function uploadThingApi(config: UploadThingInputs): UTApi {
  const fetch = proxyFetch()
  return new UTApi({
    ...(config.uploadthingToken ? {token: config.uploadthingToken} : {}),
    ...(fetch ? {fetch} : {})
  })
}

function uploadOptions(config: UploadThingInputs): {
  acl?: UploadThingAcl
  contentDisposition?: UploadThingContentDisposition
} {
  return {
    ...(config.acl ? {acl: config.acl} : {}),
    ...(config.contentDisposition
      ? {contentDisposition: config.contentDisposition}
      : {})
  }
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'artifact'
}

function zipPathName(rootDirectory: string, file: string): string {
  const relativePath = path.relative(rootDirectory, file) || path.basename(file)
  return relativePath.split(path.sep).join('/')
}

function pageDataObject(
  page: UploadThingPage
): {hasMore?: boolean; files?: readonly UploadThingFile[]} | undefined {
  if (!page.data || Array.isArray(page.data)) {
    return undefined
  }

  return page.data as {hasMore?: boolean; files?: readonly UploadThingFile[]}
}

function pageFiles(page: UploadThingPage): readonly UploadThingFile[] {
  if (page.files) {
    return page.files
  }

  if (Array.isArray(page.data)) {
    return page.data
  }

  return pageDataObject(page)?.files || []
}

function pageHasMore(page: UploadThingPage): boolean {
  return Boolean(page.hasMore || pageDataObject(page)?.hasMore)
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

async function zipFiles(
  artifactName: string,
  filesToUpload: string[],
  rootDirectory: string,
  compressionLevel = 6
): Promise<{filePath: string; cleanupDirectory: string}> {
  const cleanupDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'uploadthing-artifact-')
  )
  const filePath = path.join(
    cleanupDirectory,
    `${safeFileName(artifactName)}.zip`
  )
  const output = createWriteStream(filePath)
  const archive = new ZipArchive({zlib: {level: compressionLevel}})
  const finished = new Promise<void>((resolve, reject) => {
    output.on('close', resolve)
    output.on('error', reject)
    archive.on('error', reject)
    archive.on('warning', reject)
  })

  archive.pipe(output)
  for (const file of filesToUpload) {
    archive.file(file, {name: zipPathName(rootDirectory, file)})
  }
  await archive.finalize()
  await finished

  return {filePath, cleanupDirectory}
}

async function fileForUpload(
  artifactName: string,
  filesToUpload: string[],
  rootDirectory: string,
  options: UploadArtifactOptions
): Promise<PreparedArtifactFile> {
  if (options.archive) {
    const zip = await zipFiles(
      artifactName,
      filesToUpload,
      rootDirectory,
      options.compressionLevel
    )
    return {
      artifactName,
      fileName: `${safeFileName(artifactName)}.zip`,
      filePath: zip.filePath,
      archive: true,
      cleanupDirectory: zip.cleanupDirectory
    }
  }

  if (filesToUpload.length !== 1) {
    throw new Error(
      'UploadThing archive:false artifacts must contain exactly one file'
    )
  }

  const filePath = filesToUpload[0]
  const fileName = path.basename(filePath)
  return {artifactName: fileName, fileName, filePath, archive: false}
}

async function uploadThingFiles(api: UTApi): Promise<UploadThingFile[]> {
  const files: UploadThingFile[] = []
  let offset = 0
  let hasMore = true

  while (hasMore) {
    const page = (await api.listFiles({
      limit: listFilesLimit,
      offset
    })) as unknown as UploadThingPage
    const pageItems = pageFiles(page)
    files.push(...pageItems)
    offset += pageItems.length
    hasMore = pageHasMore(page) && pageItems.length > 0
  }

  return files
}

async function findArtifactByCustomId(
  customId: string,
  config: UploadThingInputs
): Promise<StoredArtifact | undefined> {
  return (await listArtifacts(config)).find(
    artifact => artifact.customId === customId
  )
}

function uploadData(result: unknown): UploadThingFile {
  const item = Array.isArray(result) ? result[0] : (result as any)
  if (item?.error) {
    throw new Error(
      `UploadThing upload failed: ${item.error.message || item.error}`
    )
  }

  const data = item?.data || item
  return Array.isArray(data) ? data[0] : data
}

async function signedUrl(
  key: string,
  config: UploadThingInputs
): Promise<string> {
  const result = await uploadThingApi(config).generateSignedURL(key, {
    expiresIn: (config.signedUrlExpiresIn || '1 hour') as any
  })
  return result.ufsUrl
}

function publicUrl(file: UploadThingFile, key: string): string {
  return file.ufsUrl || file.url || file.appUrl || `https://utfs.io/f/${key}`
}

async function artifactUrl(
  file: UploadThingFile,
  config: UploadThingInputs
): Promise<string> {
  const key = file.key || file.fileKey || ''
  return config.acl === 'private' || config.signedUrlExpiresIn
    ? signedUrl(key, config)
    : publicUrl(file, key)
}

async function uploadFileBlob(filePath: string): Promise<Blob> {
  return openAsBlob(filePath)
}

async function downloadResponse(
  artifact: StoredArtifact,
  config: UploadThingInputs
): Promise<Response> {
  const fetcher = proxyFetch() || fetch
  const response = await fetcher(await signedUrl(artifact.key, config))
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download artifact '${artifact.name}': ${response.status} ${response.statusText}`
    )
  }
  return response
}

export async function uploadArtifact(
  artifactName: string,
  filesToUpload: string[],
  rootDirectory: string,
  options: UploadArtifactOptions
): Promise<void> {
  const uploadFile = await fileForUpload(
    artifactName,
    filesToUpload,
    rootDirectory,
    options
  )
  const customId = artifactCustomId(uploadFile.artifactName, uploadFile.archive)
  const existingArtifact = await findArtifactByCustomId(customId, options)

  try {
    if (existingArtifact) {
      if (!options.overwrite) {
        throw new Error(
          `Artifact '${uploadFile.artifactName}' already exists in this workflow run`
        )
      }
      await deleteArtifacts([existingArtifact], options)
    }

    const file = new UTFile(
      [await uploadFileBlob(uploadFile.filePath)],
      uploadFile.fileName,
      {
        customId
      }
    )
    const uploadedFile = uploadData(
      await uploadThingApi(options).uploadFiles(file, uploadOptions(options))
    )
    const key = uploadedFile.key || uploadedFile.fileKey || ''
    const digest = await sha256File(uploadFile.filePath)
    const size = (await stat(uploadFile.filePath)).size
    const url = await artifactUrl(uploadedFile, options)

    core.info(
      `Artifact ${uploadFile.artifactName} has been successfully uploaded! Final size is ${size} bytes. Artifact key is ${key}`
    )
    core.info(`Artifact download URL: ${url}`)
    core.setOutput('artifact-id', key)
    core.setOutput('artifact-key', key)
    core.setOutput('artifact-custom-id', customId)
    core.setOutput('artifact-url', url)
    core.setOutput('artifact-digest', digest)
  } finally {
    if (uploadFile.cleanupDirectory) {
      await rm(uploadFile.cleanupDirectory, {recursive: true, force: true})
    }
  }
}

export async function listArtifacts(
  config: UploadThingInputs
): Promise<StoredArtifact[]> {
  const files = await uploadThingFiles(uploadThingApi(config))
  return files
    .map(file =>
      file.customId ? parseArtifact(file.customId, file) : undefined
    )
    .filter(
      (artifact): artifact is StoredArtifact => !!artifact && !!artifact.key
    )
}

export async function downloadArtifact(
  artifact: StoredArtifact,
  destinationDirectory: string,
  config: UploadThingInputs
): Promise<void> {
  await mkdir(destinationDirectory, {recursive: true})
  const response = await downloadResponse(artifact, config)
  const stream = Readable.fromWeb(response.body! as any)

  if (artifact.archive) {
    await pipeline(stream, unzip.Extract({path: destinationDirectory}))
    return
  }

  await pipeline(
    stream,
    createWriteStream(path.join(destinationDirectory, artifact.fileName))
  )
}

export async function deleteArtifacts(
  artifacts: StoredArtifact[],
  config: UploadThingInputs
): Promise<void> {
  if (artifacts.length === 0) {
    return
  }

  await uploadThingApi(config).deleteFiles(
    artifacts.map(artifact => artifact.customId),
    {keyType: 'customId'}
  )
}
