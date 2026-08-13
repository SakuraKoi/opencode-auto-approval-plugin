---
name: release
description: >-
  Release a new version of opencode-auto-approval-plugin end to end: select a
  semantic version, prepare release notes, open and merge a release PR, publish
  a GitHub Release, monitor OIDC npm publishing, and clean up. Use when asked
  to publish or perform a production release.
targets:
  - "*"
---

1. Confirm that the current branch is `main` and the worktree is clean. Stop if either condition
   is not true.
2. Find the latest reachable `v*.*.*` tag. Compare it with `HEAD` to prepare
   `./tmp/release-notes.md`. If no previous release tag exists, compare from the repository's first
   commit instead.

   - Write the notes in English.
   - Do not include confidential information.
   - Include `What's Changed`, `Contributors`, and `Full Changelog` sections.

3. Read the requested version without its `v` prefix. If it was not specified, choose it from the
   release notes using semantic versioning: breaking change → major, feature → minor, fix → patch.
   Validate that it is a new `MAJOR.MINOR.PATCH` version.
4. Run `git pull --ff-only origin main`, then create `release/v<new_version>` from the updated
   branch.
5. Run `pnpm version <new_version> --no-git-tag-version` to update `package.json`.
6. Run `pnpm cicheck` and `pnpm build`. Fix failures before continuing.
7. Commit the version bump without bypassing hooks and push the release branch.
8. Open a pull request to `main`. Include the associated issue link in its description, as required
   by this repository. Wait for required checks, then merge the pull request.
9. Update local `main` with `git pull --ff-only origin main`. Create and publish the release with:

   ```bash
   gh release create "v<new_version>" --target main --title "v<new_version>" --notes-file ./tmp/release-notes.md
   ```

   Publishing the GitHub Release triggers the `Release` workflow. The workflow verifies the tag,
   version, and `main` ancestry before publishing through npm Trusted Publishing (OIDC).

10. Monitor the latest `Release` workflow with `gh run list --workflow=Release --limit 1` and wait
    until it completes successfully. If it fails, report the failure and preserve the release branch
    for investigation.
11. After a successful publish, switch to `main`, delete the merged `release/v<new_version>` branch,
    and run `git pull --prune`.

Do not run `pnpm publish` directly for normal releases. Version `0.1.0` was the one-time manual npm
publication used to create the package; do not create a GitHub Release for that already-published
version. Configure npm Trusted Publishing before the next release.
