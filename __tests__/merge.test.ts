import {jest, describe, test, expect, beforeEach} from '@jest/globals'
import * as path from 'path'

jest.unstable_mockModule('@actions/core', () => ({
  getInput: jest.fn(),
  getBooleanInput: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  setSecret: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  startGroup: jest.fn(),
  endGroup: jest.fn(),
  isDebug: jest.fn(() => false),
  getState: jest.fn(),
  saveState: jest.fn(),
  exportVariable: jest.fn(),
  addPath: jest.fn(),
  group: jest.fn((name: string, fn: () => Promise<unknown>) => fn()),
  toPlatformPath: jest.fn((p: string) => p),
  toWin32Path: jest.fn((p: string) => p),
  toPosixPath: jest.fn((p: string) => p)
}))

const actualFsPromises = await import('fs/promises')
jest.unstable_mockModule('fs/promises', () => ({
  ...actualFsPromises,
  mkdtemp: jest
    .fn<() => Promise<string>>()
    .mockResolvedValue('/tmp/merge-artifact'),
  rm: jest.fn<() => Promise<void>>().mockResolvedValue(undefined)
}))

const mockFindFilesToUpload =
  jest.fn<() => Promise<{filesToUpload: string[]; rootDirectory: string}>>()
jest.unstable_mockModule('../src/shared/search.js', () => ({
  findFilesToUpload: mockFindFilesToUpload
}))

const mockListArtifacts = jest.fn<(...args: any[]) => Promise<any[]>>()
const mockDownloadArtifact = jest.fn<(...args: any[]) => Promise<void>>()
const mockUploadArtifact = jest.fn<(...args: any[]) => Promise<void>>()
const mockDeleteArtifacts = jest.fn<(...args: any[]) => Promise<void>>()
jest.unstable_mockModule('../src/shared/upload-artifact.js', () => ({
  listArtifacts: mockListArtifacts,
  downloadArtifact: mockDownloadArtifact,
  uploadArtifact: mockUploadArtifact,
  deleteArtifacts: mockDeleteArtifacts
}))

const core = await import('@actions/core')
const {run} = await import('../src/merge/merge-artifacts.js')
const {Inputs} = await import('../src/merge/constants.js')
const {UploadThingInputNames} =
  await import('../src/shared/uploadthing-input-helper.js')

const fixtures = {
  artifactName: 'my-merged-artifact',
  tmpDirectory: '/tmp/merge-artifact',
  filesToUpload: [
    '/some/artifact/path/file-a.txt',
    '/some/artifact/path/file-b.txt',
    '/some/artifact/path/file-c.txt'
  ],
  artifacts: [
    {
      name: 'my-artifact-a',
      key: 'key-a',
      customId: 'custom-a',
      fileName: 'my-artifact-a.zip',
      size: 100,
      archive: true
    },
    {
      name: 'my-artifact-b',
      key: 'key-b',
      customId: 'custom-b',
      fileName: 'my-artifact-b.zip',
      size: 100,
      archive: true
    },
    {
      name: 'my-artifact-c',
      key: 'key-c',
      customId: 'custom-c',
      fileName: 'my-artifact-c.zip',
      size: 100,
      archive: true
    }
  ]
}

const mockInputs = (
  overrides?: Partial<{[K in (typeof Inputs)[keyof typeof Inputs]]?: any}> &
    Record<string, any>
) => {
  const inputs: Record<string, any> = {
    [Inputs.Name]: fixtures.artifactName,
    [Inputs.Pattern]: '*',
    [Inputs.SeparateDirectories]: false,
    [Inputs.CompressionLevel]: '6',
    [Inputs.DeleteMerged]: false,
    [Inputs.IncludeHiddenFiles]: false,
    [UploadThingInputNames.UploadThingToken]: '',
    [UploadThingInputNames.Acl]: '',
    [UploadThingInputNames.ContentDisposition]: '',
    [UploadThingInputNames.SignedUrlExpiresIn]: '',
    ...overrides
  }

  ;(core.getInput as jest.Mock<typeof core.getInput>).mockImplementation(
    (name: string) => inputs[name]
  )
  ;(
    core.getBooleanInput as jest.Mock<typeof core.getBooleanInput>
  ).mockImplementation((name: string) => inputs[name])

  return inputs
}

describe('merge', () => {
  beforeEach(() => {
    mockInputs()
    jest.clearAllMocks()
    mockListArtifacts.mockResolvedValue(fixtures.artifacts)
    mockDownloadArtifact.mockResolvedValue(undefined)
    mockUploadArtifact.mockResolvedValue(undefined)
    mockDeleteArtifacts.mockResolvedValue(undefined)
    mockFindFilesToUpload.mockResolvedValue({
      filesToUpload: fixtures.filesToUpload,
      rootDirectory: fixtures.tmpDirectory
    })
  })

  test('merges artifacts', async () => {
    await run()

    for (const artifact of fixtures.artifacts) {
      expect(mockDownloadArtifact).toHaveBeenCalledWith(
        artifact,
        fixtures.tmpDirectory,
        expect.any(Object)
      )
    }
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      fixtures.artifactName,
      fixtures.filesToUpload,
      fixtures.tmpDirectory,
      expect.objectContaining({
        archive: true,
        compressionLevel: 6,
        overwrite: false
      })
    )
  })

  test('fails if no artifacts found', async () => {
    mockInputs({[Inputs.Pattern]: 'this-does-not-match'})

    await expect(run()).rejects.toThrow(
      "No artifacts found matching pattern 'this-does-not-match'"
    )

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockDownloadArtifact).not.toHaveBeenCalled()
  })

  test('filters artifacts by pattern', async () => {
    mockInputs({[Inputs.Pattern]: 'my-artifact-a'})

    await run()

    expect(mockDownloadArtifact).toHaveBeenCalledTimes(1)
    expect(mockDownloadArtifact).toHaveBeenCalledWith(
      fixtures.artifacts[0],
      fixtures.tmpDirectory,
      expect.any(Object)
    )
  })

  test('downloads artifacts into separate directories', async () => {
    mockInputs({[Inputs.SeparateDirectories]: true})

    await run()

    for (const artifact of fixtures.artifacts) {
      expect(mockDownloadArtifact).toHaveBeenCalledWith(
        artifact,
        path.join(fixtures.tmpDirectory, artifact.name),
        expect.any(Object)
      )
    }
  })

  test('supports custom compression level', async () => {
    mockInputs({[Inputs.CompressionLevel]: '2'})

    await run()

    expect(mockUploadArtifact).toHaveBeenCalledWith(
      fixtures.artifactName,
      fixtures.filesToUpload,
      fixtures.tmpDirectory,
      expect.objectContaining({compressionLevel: 2})
    )
  })

  test('passes UploadThing inputs to storage helpers', async () => {
    mockInputs({
      [UploadThingInputNames.UploadThingToken]: 'token-value',
      [UploadThingInputNames.Acl]: 'private',
      [UploadThingInputNames.ContentDisposition]: 'attachment',
      [UploadThingInputNames.SignedUrlExpiresIn]: '15 minutes'
    })

    await run()

    expect(core.setSecret).toHaveBeenCalledWith('token-value')
    expect(mockListArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({uploadthingToken: 'token-value'})
    )
    expect(mockUploadArtifact).toHaveBeenCalledWith(
      fixtures.artifactName,
      fixtures.filesToUpload,
      fixtures.tmpDirectory,
      expect.objectContaining({
        uploadthingToken: 'token-value',
        acl: 'private',
        contentDisposition: 'attachment',
        signedUrlExpiresIn: '15 minutes'
      })
    )
  })

  test('supports deleting artifacts after merge', async () => {
    mockInputs({[Inputs.DeleteMerged]: true})

    await run()

    expect(mockDeleteArtifacts).toHaveBeenCalledWith(
      fixtures.artifacts,
      expect.any(Object)
    )
  })
})
