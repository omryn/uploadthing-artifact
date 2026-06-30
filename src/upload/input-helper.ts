import * as core from '@actions/core'
import {Inputs, NoFileOptions} from './constants.js'
import {UploadInputs} from './upload-inputs.js'
import {getUploadThingInputs} from '../shared/uploadthing-input-helper.js'

/**
 * Helper to get all the inputs for the action
 */
export function getInputs(): UploadInputs {
  const name = core.getInput(Inputs.Name)
  const path = core.getInput(Inputs.Path, {required: true})
  const overwrite = core.getBooleanInput(Inputs.Overwrite)
  const includeHiddenFiles = core.getBooleanInput(Inputs.IncludeHiddenFiles)
  const archive = core.getBooleanInput(Inputs.Archive)
  const uploadThingInputs = getUploadThingInputs()

  const ifNoFilesFound = core.getInput(Inputs.IfNoFilesFound)
  const noFileBehavior: NoFileOptions = NoFileOptions[ifNoFilesFound]

  if (!noFileBehavior) {
    core.setFailed(
      `Unrecognized ${
        Inputs.IfNoFilesFound
      } input. Provided: ${ifNoFilesFound}. Available options: ${Object.keys(
        NoFileOptions
      )}`
    )
  }

  const inputs = {
    artifactName: name,
    searchPath: path,
    ifNoFilesFound: noFileBehavior,
    overwrite: overwrite,
    includeHiddenFiles: includeHiddenFiles,
    archive: archive,
    ...uploadThingInputs
  } as UploadInputs

  const retentionDaysStr = core.getInput(Inputs.RetentionDays)
  if (retentionDaysStr) {
    inputs.retentionDays = parseInt(retentionDaysStr)
    if (isNaN(inputs.retentionDays)) {
      core.setFailed('Invalid retention-days')
    } else {
      core.warning(
        'retention-days is not supported by UploadThing and will be ignored'
      )
    }
  }

  const compressionLevelStr = core.getInput(Inputs.CompressionLevel)
  if (compressionLevelStr) {
    inputs.compressionLevel = parseInt(compressionLevelStr)
    if (isNaN(inputs.compressionLevel)) {
      core.setFailed('Invalid compression-level')
    }

    if (inputs.compressionLevel < 0 || inputs.compressionLevel > 9) {
      core.setFailed('Invalid compression-level. Valid values are 0-9')
    }
  }

  return inputs
}
