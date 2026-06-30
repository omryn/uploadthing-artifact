# UploadThing-only storage migration plan

Goal: replace this action's GitHub Actions artifact storage implementation with UploadThing-only storage. No GitHub artifact API, UI, or `actions/download-artifact` compatibility should remain in the runtime behavior.

## Current repository behavior

- Upload action resolves files with `src/shared/search.ts`.
- Upload action stores artifacts through `@actions/artifact` in `src/shared/upload-artifact.ts`.
- `overwrite` deletes GitHub artifacts by name before upload.
- Merge action lists/downloads/deletes GitHub artifacts through `@actions/artifact`.
- Docs and action metadata describe GitHub artifact IDs, GitHub artifact URLs, retention days, GHES, and GitHub artifact UI behavior.

## UploadThing docs facts to use

- Server-side uploads should use `UTApi.uploadFiles` from `uploadthing/server`.
- Auth uses `UPLOADTHING_TOKEN` or `UTApi({ token })`.
- Uploaded file data includes `key`, `ufsUrl`, `name`, `size`, `customId`, and file metadata.
- Files are accessed at `https://<APP_ID>.ufs.sh/f/<FILE_KEY>` or via `ufsUrl` returned by the SDK.
- Private files need signed URLs via `UTApi.generateSignedURL`.
- Delete/list operations are available through `UTApi.deleteFiles` and `UTApi.listFiles`.
- `UTApi.uploadFiles` supports `contentDisposition`, `acl`, and `concurrency`; it does not expose GitHub-style per-artifact retention days.

## Target behavior

- Upload one UploadThing file per logical artifact.
- If `archive: true`, zip selected files before upload and preserve paths relative to the search root.
- If `archive: false`, upload the single file directly.
- Compute SHA-256 locally over the uploaded bytes and expose it as `artifact-digest`.
- Output UploadThing identifiers and URLs, not GitHub artifact IDs/URLs.
- Use stable UploadThing `customId`s to identify artifacts in a workflow run.
- Keep artifact discovery scoped to the current GitHub run by encoding run context in `customId`.

## Implementation TODO

### 1. Finalize public action API

- [ ] Keep compatible inputs where they still make sense:
  - `name`
  - `path`
  - `if-no-files-found`
  - `compression-level`
  - `overwrite`
  - `include-hidden-files`
  - `archive`
- [ ] Add UploadThing inputs:
  - `uploadthing-token`, optional with `UPLOADTHING_TOKEN` fallback
  - `acl`: `public-read | private`
  - `content-disposition`: `inline | attachment`
  - `signed-url-expires-in` for private artifact URLs
  - `concurrency` if multi-upload support is later added
- [ ] Decide unsupported input behavior for `retention-days`:
  - remove it,
  - ignore with warning,
  - or fail as unsupported.
- [ ] Define outputs:
  - `artifact-key`: UploadThing file key
  - `artifact-custom-id`: deterministic custom ID
  - `artifact-url`: `ufsUrl` or signed private URL
  - `artifact-digest`: local SHA-256 digest
  - decide whether `artifact-id` aliases `artifact-key` or is removed

### 2. Add UploadThing storage adapter

- [ ] Add `uploadthing` dependency.
- [ ] Add a zip dependency or implement zip creation with a small focused library.
- [ ] Create a shared storage module for:
  - `uploadArtifactToUploadThing`
  - `deleteArtifactFromUploadThing`
  - `listRunArtifactsFromUploadThing`
  - `downloadArtifactFromUploadThing`
- [ ] Build `UTApi` with token/config and optional proxy-aware fetch if needed.
- [ ] Convert searched files into one uploadable artifact file:
  - zip directory payload when `archive: true`
  - direct single file when `archive: false`
- [ ] Create `UTFile` instances with deterministic `customId`.
- [ ] Set UploadThing upload options from action inputs.
- [ ] Fail if UploadThing returns per-file upload errors.

### 3. Artifact identity and overwrite

- [ ] Generate deterministic logical artifact IDs from:
  - repository owner/name
  - workflow run ID
  - run attempt
  - artifact name
- [ ] Hash the identity to fit UploadThing `customId` length limits.
- [ ] Store enough metadata in `customId` or a sidecar manifest to recover logical artifact names for merge.
- [ ] For `overwrite: true`, delete by `customId` before uploading.
- [ ] For `overwrite: false`, check for an existing `customId` and fail on conflict.

### 4. Upload action changes

- [ ] Replace `@actions/artifact` usage in `src/upload/upload-artifact.ts` and `src/shared/upload-artifact.ts`.
- [ ] Remove GitHub artifact URL construction.
- [ ] Preserve existing no-files behavior.
- [ ] Preserve `archive: false` validation: exactly one file.
- [ ] Log UploadThing key, URL, size, and digest.
- [ ] Avoid leaking UploadThing token in logs.

### 5. Merge action changes

- [ ] Replace `artifactClient.listArtifacts` with UploadThing artifact listing scoped to current run.
- [ ] Match `pattern` against logical artifact names.
- [ ] Download matched UploadThing files via `ufsUrl` or signed URL.
- [ ] Extract zipped artifacts to a temp directory.
- [ ] For direct-file artifacts, copy the file directly into the merge temp directory.
- [ ] Preserve `separate-directories` semantics.
- [ ] Re-upload merged output through the shared UploadThing upload helper.
- [ ] Implement `delete-merged` via `UTApi.deleteFiles` by `customId` or file key.

### 6. Proxy support

- [ ] Verify whether UploadThing SDK fetch honors `http_proxy` / `https_proxy` in GitHub Actions.
- [ ] If not, add a proxy-aware fetch implementation.
- [ ] Pass proxy-aware fetch into `new UTApi({ fetch })`.
- [ ] Update proxy E2E workflow to validate UploadThing upload through the proxy.

### 7. Documentation updates

- [ ] Rewrite `README.md` for UploadThing-only storage.
- [ ] Update `action.yml` input/output descriptions.
- [ ] Rewrite `merge/README.md` and `merge/action.yml`.
- [ ] Remove GHES and GitHub artifact REST API language.
- [ ] Remove or rewrite `docs/MIGRATION.md`.
- [ ] Document required UploadThing dashboard setup.
- [ ] Document `UPLOADTHING_TOKEN` setup in GitHub Actions secrets.
- [ ] Document that `actions/download-artifact` is not compatible.
- [ ] Document private ACL URL signing behavior.
- [ ] Document unsupported or changed retention behavior.

### 8. Tests

- [ ] Replace `@actions/artifact` mocks with UploadThing storage adapter mocks.
- [ ] Add upload tests for:
  - zipped multi-file artifact
  - direct single-file upload
  - no-files behavior
  - overwrite behavior
  - existing artifact conflict
  - digest output
  - private signed URL output
- [ ] Add merge tests for:
  - list/filter by pattern
  - separate directories
  - direct-file artifact inputs
  - delete merged artifacts
  - missing matching artifacts
- [ ] Keep search tests unchanged unless path preservation logic moves.

### 9. CI and release artifacts

- [ ] Update E2E workflow to use UploadThing secrets.
- [ ] Replace `actions/download-artifact` verification with downloads from action outputs.
- [ ] Split UploadThing E2E into a workflow/job that can skip when secrets are unavailable on forks.
- [ ] Keep `check-dist` but rebuild `dist/upload` and `dist/merge` after implementation.
- [ ] Update cleanup to delete UploadThing test files instead of GitHub artifacts.
- [ ] Reassess third-party dependency license cache if production dependencies change.

## Open decisions

1. Should the merge sub-action be preserved in the first implementation, or should upload-only ship first?
2. Should default ACL be `public-read`, or should the action use the app default unless explicitly configured?
3. Should this repo add a companion download action for UploadThing artifacts?
4. Should `retention-days` be removed, ignored with a warning, or treated as an error?
5. Should artifact metadata live only in `customId`, or should each upload include a small manifest to support richer merge/download behavior?
