# UploadThing Artifact Merge Action

Merge artifacts uploaded by this repository's UploadThing artifact action in the same workflow run.

The merge action lists UploadThing files whose deterministic `customId` belongs to the current repository, workflow run, and run attempt. It downloads matching artifacts, extracts zipped artifacts, then uploads one new zipped artifact to UploadThing.

## Usage

```yaml
- uses: your-org/uploadthing-artifact/merge@v1
  with:
    name: merged-artifacts
    pattern: build-*
```

`UPLOADTHING_TOKEN` must be available in the environment, or pass `uploadthing-token`.

## Inputs

```yaml
- uses: your-org/uploadthing-artifact/merge@v1
  with:
    # Name of the merged artifact.
    # Optional. Default is 'merged-artifacts'
    name:

    # Glob pattern matching UploadThing artifact names from this workflow run.
    # Optional. Default is '*'
    pattern:

    # Put each matched artifact into a directory named after the artifact.
    # Optional. Default is 'false'
    separate-directories:

    # Delete source artifacts from UploadThing after the merged artifact is uploaded.
    # Optional. Default is 'false'
    delete-merged:

    # Unsupported by UploadThing. Parsed for compatibility and ignored with a warning.
    retention-days:

    # Zip compression level for the merged artifact.
    # Optional. Default is '6'
    compression-level:

    # Include hidden files when collecting downloaded artifacts for the merged zip.
    # Optional. Default is 'false'
    include-hidden-files:

    # UploadThing token. Defaults to UPLOADTHING_TOKEN.
    uploadthing-token:

    # UploadThing ACL for the merged artifact: public-read or private.
    acl:

    # Content-Disposition for the merged artifact: inline or attachment.
    content-disposition:

    # If set, artifact-url is a signed URL that expires after this duration.
    signed-url-expires-in:
```

## Outputs

| Name | Description |
| - | - |
| `artifact-id` | Alias for `artifact-key`, kept for compatibility. |
| `artifact-key` | UploadThing file key for the merged artifact. |
| `artifact-custom-id` | UploadThing custom ID for the merged artifact. |
| `artifact-url` | UploadThing URL, or a signed URL for private artifacts. |
| `artifact-digest` | SHA-256 digest of the uploaded merged zip. |

## Examples

### Merge all artifacts in a run

```yaml
jobs:
  upload:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - run: echo "hello from ${{ matrix.os }}" > file-${{ matrix.os }}.txt
      - uses: your-org/uploadthing-artifact@v1
        with:
          name: build-${{ matrix.os }}
          path: file-${{ matrix.os }}.txt

  merge:
    runs-on: ubuntu-latest
    needs: upload
    steps:
      - uses: your-org/uploadthing-artifact/merge@v1
        with:
          name: all-builds
          pattern: build-*
          separate-directories: true
```

### Delete source artifacts after merge

```yaml
- uses: your-org/uploadthing-artifact/merge@v1
  with:
    name: release-bundle
    pattern: release-*
    delete-merged: true
```

## Notes

- Only artifacts uploaded by this action in the current workflow run/run attempt are considered.
- GitHub Actions artifact APIs and `actions/download-artifact` are not used.
- Source direct-file artifacts are copied as files; zipped artifacts are extracted before merge.
