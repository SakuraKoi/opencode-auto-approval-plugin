---
name: security-review
description: >-
  Perform an evidence-based security review of an entire repository, including
  application code, dependencies, package distribution, CI/CD, GitHub settings,
  Dev Containers, and AI-agent configuration. Use when asked to audit, review,
  assess, or harden a repository, especially for vulnerabilities or supply-chain
  risks.
targets:
  - "*"
---

1. Confirm the repository root and record the initial branch and worktree state. Do not modify
   project files, external services, branches, issues, releases, or secrets unless the user asks.
2. Read the repository's applicable instructions before reviewing files. Inventory all tracked files,
   then inspect source code, manifests, lockfiles, workflow files, Dev Container files, AI-tool
   configuration, and generated-file source rather than only generated outputs.
3. Review trust boundaries in application code. Trace untrusted inputs to privileged actions,
   including command execution, filesystem access, network access, authorization decisions, model
   prompts, data disclosure, resource exhaustion, race conditions, and fail-open behavior.
4. Check the published artifact when the project distributes a package. Inspect its file list and
   security-relevant code, and compare its version and integrity with the public registry. Do not
   publish or install globally as part of a review.
5. Run proportionate local checks: existing project quality gates, a production dependency audit and
   a full dependency audit, secret scanning, Git object integrity, actionlint, action pinning, and
   configuration scanning when the repository provides them. Distinguish production dependency
   findings from development-only findings.
6. Inspect CI/CD and release paths for untrusted expression interpolation, excessive token or OIDC
   permissions, unpinned actions, unsafe install scripts, unprotected release sources, and missing
   provenance. Query GitHub repository settings and branch protection when credentials permit; state
   clearly when a setting cannot be verified.
7. Treat Dev Containers and AI-agent configuration as security-sensitive code. Flag automatic pulls
   or installs, remote scripts without immutable verification, untrusted registries, privileged
   containers, broad capabilities, passwordless sudo, dangerous auto-approval, and unnecessary
   credential forwarding.
8. Report only evidence-backed findings, ordered by severity. For every finding, give the impact,
   attack path, exact file or setting, and a concrete remediation. Also report clean checks, their
   scope, remaining uncertainty, and any actions intentionally not taken.
