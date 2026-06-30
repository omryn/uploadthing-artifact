import * as core from '@actions/core'

export type UploadThingAcl = 'public-read' | 'private'
export type UploadThingContentDisposition = 'inline' | 'attachment'

export interface UploadThingInputs {
  uploadthingToken?: string
  acl?: UploadThingAcl
  contentDisposition?: UploadThingContentDisposition
  signedUrlExpiresIn?: string
}

export enum UploadThingInputNames {
  UploadThingToken = 'uploadthing-token',
  Acl = 'acl',
  ContentDisposition = 'content-disposition',
  SignedUrlExpiresIn = 'signed-url-expires-in'
}

const uploadThingAcls = ['public-read', 'private'] as const
const uploadThingContentDispositions = ['inline', 'attachment'] as const

function optionalInput(name: UploadThingInputNames): string | undefined {
  return core.getInput(name) || undefined
}

function uploadThingToken(): string | undefined {
  return (
    optionalInput(UploadThingInputNames.UploadThingToken) ||
    process.env.UPLOADTHING_TOKEN
  )
}

function validateInput<T extends string>(
  name: UploadThingInputNames,
  value: string | undefined,
  validValues: readonly T[]
): T | undefined {
  if (!value) {
    return undefined
  }

  if (validValues.includes(value as T)) {
    return value as T
  }

  throw new Error(
    `Invalid ${name}: ${value}. Valid values are: ${validValues.join(', ')}`
  )
}

export function getUploadThingInputs(): UploadThingInputs {
  const uploadthingToken = uploadThingToken()
  if (uploadthingToken) {
    core.setSecret(uploadthingToken)
  }

  return {
    uploadthingToken,
    acl: validateInput(
      UploadThingInputNames.Acl,
      optionalInput(UploadThingInputNames.Acl),
      uploadThingAcls
    ),
    contentDisposition: validateInput(
      UploadThingInputNames.ContentDisposition,
      optionalInput(UploadThingInputNames.ContentDisposition),
      uploadThingContentDispositions
    ),
    signedUrlExpiresIn: optionalInput(UploadThingInputNames.SignedUrlExpiresIn)
  }
}
