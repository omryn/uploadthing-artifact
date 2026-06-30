# Migration to UploadThing storage

This repository now stores artifacts in UploadThing only. It no longer creates GitHub Actions artifacts.

## What changes

- Uploads go to UploadThing through `UTApi.uploadFiles`.
- `artifact-url` is an UploadThing URL, not a GitHub URL.
- `artifact-id` is an alias for the UploadThing file key.
- `actions/download-artifact` cannot download these artifacts.
- `retention-days` is ignored because UploadThing does not support GitHub-style per-artifact retention through this action.
- Artifact overwrite/delete/merge behavior is implemented with UploadThing `customId`s scoped to the current repository, workflow run, and run attempt.

## Required workflow change

Add an UploadThing token:

```yaml
env:
  UPLOADTHING_TOKEN: ${{ secrets.UPLOADTHING_TOKEN }}
```

or pass it directly:

```yaml
- uses: your-org/uploadthing-artifact@v1
  with:
    uploadthing-token: ${{ secrets.UPLOADTHING_TOKEN }}
    name: build
    path: dist/
```

## Downloading artifacts

Replace `actions/download-artifact` steps with direct downloads from the action output.

```yaml
- uses: your-org/uploadthing-artifact@v1
  id: artifact
  with:
    name: build
    path: dist/

- run: |
    curl -fsSL '${{ steps.artifact.outputs.artifact-url }}' -o build.zip
    unzip -q build.zip -d build
```

For `archive: false`, download the URL directly as the file.

## Private artifacts

Use UploadThing ACL and signed URL outputs:

```yaml
- uses: your-org/uploadthing-artifact@v1
  id: artifact
  with:
    name: private-report
    path: report.html
    acl: private
    signed-url-expires-in: 1 hour
```

## Merge migration

Use the included merge action instead of GitHub artifact download/reupload flows:

```yaml
- uses: your-org/uploadthing-artifact/merge@v1
  with:
    name: merged-artifacts
    pattern: build-*
    separate-directories: true
```

Only artifacts created in the current workflow run/run attempt are included.
