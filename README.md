# UploadThing Artifact Action

Upload workflow artifacts to [UploadThing](https://uploadthing.com/) storage instead of GitHub Actions artifact storage.

This action keeps the familiar `actions/upload-artifact` path/glob behavior, but uploaded files are stored in UploadThing. They are not visible in the GitHub Actions artifact UI and cannot be downloaded with `actions/download-artifact`.

## Requirements

Create an UploadThing token in the UploadThing dashboard and save it as the GitHub secret `APTApiKey`. Expose it to the action as `UPLOADTHING_TOKEN`.

```yaml
env:
  UPLOADTHING_TOKEN: ${{ secrets.APTApiKey }}
```

You can also pass the token with the `uploadthing-token` input.

## Usage

```yaml
- uses: your-org/uploadthing-artifact@v1
  with:
    name: build-output
    path: dist/
```

### Inputs

```yaml
- uses: your-org/uploadthing-artifact@v1
  with:
    # Artifact name. Ignored when archive is false; then the uploaded file name is used.
    # Optional. Default is 'artifact'
    name:

    # File, directory, or wildcard pattern to upload.
    # Required.
    path:

    # Behavior if no files are found: warn, error, ignore.
    # Optional. Default is 'warn'
    if-no-files-found:

    # Zip compression level from 0 to 9 when archive is true.
    # Optional. Default is '6'
    compression-level:

    # Delete an existing UploadThing artifact for the same workflow run and artifact name before upload.
    # Optional. Default is 'false'
    overwrite:

    # Include hidden files in the artifact search.
    # Optional. Default is 'false'
    include-hidden-files:

    # Zip matched files before uploading. If false, path must resolve to exactly one file.
    # Optional. Default is 'true'
    archive:

    # UploadThing token. Defaults to UPLOADTHING_TOKEN.
    uploadthing-token:

    # UploadThing ACL: public-read or private. Defaults to the app setting.
    acl:

    # Content-Disposition: inline or attachment. Defaults to UploadThing behavior.
    content-disposition:

    # If set, artifact-url is a signed URL that expires after this duration.
    # Useful for private artifacts. Examples: 30m, 1 hour, 7 days.
    signed-url-expires-in:
```

### Outputs

| Name | Description |
| - | - |
| `artifact-id` | Alias for `artifact-key`, kept for compatibility. |
| `artifact-key` | UploadThing file key. |
| `artifact-custom-id` | Deterministic UploadThing custom ID scoped to repository, run, attempt, and artifact name. |
| `artifact-url` | UploadThing `ufsUrl`, or a signed URL when `acl: private` or `signed-url-expires-in` is set. |
| `artifact-digest` | SHA-256 digest of the uploaded bytes. |

## Examples

### Upload a directory

```yaml
- uses: your-org/uploadthing-artifact@v1
  id: upload
  with:
    name: app-dist
    path: dist/

- run: echo '${{ steps.upload.outputs.artifact-url }}'
```

### Upload one file without zipping

```yaml
- uses: your-org/uploadthing-artifact@v1
  with:
    path: report.html
    archive: false
```

When `archive: false`, only one file may be uploaded and the file name is used as the artifact name.

### Upload a private artifact

```yaml
- uses: your-org/uploadthing-artifact@v1
  id: upload
  with:
    name: private-report
    path: report.html
    acl: private
    signed-url-expires-in: 1 hour
```

### Overwrite within a workflow run

```yaml
- uses: your-org/uploadthing-artifact@v1
  with:
    name: app-dist
    path: dist/
    overwrite: true
```

Artifacts are identified by UploadThing `customId` scoped to the current repository, workflow run, run attempt, and logical artifact name.

## Path behavior

- Relative and absolute paths are supported.
- Wildcards are powered by `@actions/glob`.
- With multiple paths, the least common ancestor is used as the archive root.
- Hidden files are excluded unless `include-hidden-files: true` is set.

## Limitations

- `actions/download-artifact` is not compatible with these artifacts.
- GitHub artifact retention settings do not apply.
- UploadThing quotas, ACL, region, and file lifecycle are controlled by the UploadThing app settings.

## Merge action

Use the companion merge action to merge UploadThing artifacts created in the same workflow run. See [`merge/README.md`](merge/README.md).
