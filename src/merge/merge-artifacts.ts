import * as path from 'path'
import {mkdtemp, rm} from 'fs/promises'
import * as core from '@actions/core'
import {Minimatch} from 'minimatch'
import {getInputs} from './input-helper.js'
import {
  deleteArtifacts,
  downloadArtifact,
  listArtifacts,
  uploadArtifact
} from '../shared/upload-artifact.js'
import {findFilesToUpload} from '../shared/search.js'

const PARALLEL_DOWNLOADS = 5

export const chunk = <T>(arr: T[], n: number): T[][] =>
  arr.reduce((acc, cur, i) => {
    const index = Math.floor(i / n)
    acc[index] = [...(acc[index] || []), cur]
    return acc
  }, [] as T[][])

function downloadPath(
  tmpDir: string,
  artifactName: string,
  separate: boolean
): string {
  return separate ? path.join(tmpDir, artifactName) : tmpDir
}

export async function run(): Promise<void> {
  const inputs = getInputs()
  const tmpDir = await mkdtemp('merge-artifact')

  const listedArtifacts = await listArtifacts(inputs.uploadThing)
  const matcher = new Minimatch(inputs.pattern)
  const artifacts = listedArtifacts.filter(artifact =>
    matcher.match(artifact.name)
  )
  core.debug(
    `Filtered from ${listedArtifacts.length} to ${artifacts.length} artifacts`
  )

  if (artifacts.length === 0) {
    throw new Error(`No artifacts found matching pattern '${inputs.pattern}'`)
  }

  core.info(`Preparing to download the following artifacts:`)
  artifacts.forEach(artifact => {
    core.info(
      `- ${artifact.name} (Key: ${artifact.key}, Size: ${artifact.size})`
    )
  })

  const downloadPromises = artifacts.map(artifact =>
    downloadArtifact(
      artifact,
      downloadPath(tmpDir, artifact.name, inputs.separateDirectories),
      inputs.uploadThing
    )
  )

  const chunkedPromises = chunk(downloadPromises, PARALLEL_DOWNLOADS)
  for (const chunk of chunkedPromises) {
    await Promise.all(chunk)
  }

  const searchResult = await findFilesToUpload(
    tmpDir,
    inputs.includeHiddenFiles
  )

  await uploadArtifact(
    inputs.name,
    searchResult.filesToUpload,
    searchResult.rootDirectory,
    {
      archive: true,
      compressionLevel: inputs.compressionLevel,
      retentionDays: inputs.retentionDays,
      overwrite: false,
      ...inputs.uploadThing
    }
  )

  core.info(
    `The ${artifacts.length} artifact(s) have been successfully merged!`
  )

  if (inputs.deleteMerged) {
    await deleteArtifacts(artifacts, inputs.uploadThing)
    core.info(`The ${artifacts.length} artifact(s) have been deleted`)
  }

  try {
    await rm(tmpDir, {recursive: true})
  } catch (error) {
    core.warning(
      `Unable to remove temporary directory: ${(error as Error).message}`
    )
  }
}
