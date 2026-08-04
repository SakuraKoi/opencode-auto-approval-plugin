# opencode-auto-approval-plugin

An [opencode](https://opencode.ai/) plugin that auto-approves tool permission requests based on
configurable rules.

> [!NOTE]
> The repository is scaffolded from [dyoshikawa/ts-template](https://github.com/dyoshikawa/ts-template);
> the plugin implementation itself is not written yet — `src/index.ts` still holds the template's
> sample export.

## Toolchain

| Area              | Tool                                                                              | Config                                         |
| ----------------- | --------------------------------------------------------------------------------- | ---------------------------------------------- |
| Runtime / tooling | [mise](https://mise.jdx.dev/)                                                     | `mise.toml`                                    |
| Package manager   | [pnpm](https://pnpm.io/)                                                          | `pnpm-workspace.yaml`, `.npmrc`                |
| Language          | [TypeScript](https://www.typescriptlang.org/)                                     | `tsconfig.json`                                |
| Build             | [tsdown](https://tsdown.dev/)                                                     | `tsdown.config.ts`                             |
| Test              | [Vitest](https://vitest.dev/)                                                     | `vitest.config.ts`                             |
| Format            | [oxfmt](https://oxc.rs/)                                                          | `.oxfmtrc.json`                                |
| Lint              | [oxlint](https://oxc.rs/)                                                         | `.oxlintrc.json`                               |
| Unused code       | [knip](https://knip.dev/)                                                         | `knip.ts`                                      |
| Spelling          | [cspell](https://cspell.org/)                                                     | `cspell.json`                                  |
| Secret scanning   | [secretlint](https://github.com/secretlint/secretlint)                            | `.secretlintrc.json`                           |
| Git hooks         | [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks) + lint-staged | `package.json`, `.lintstagedrc.js`             |
| AI rules          | [rulesync](https://github.com/dyoshikawa/rulesync)                                | `rulesync.jsonc`, `.rulesync/`                 |
| Workflow lint     | [actionlint](https://github.com/rhysd/actionlint)                                 | `.github/workflows/actionlint.yml`             |
| Action pinning    | [pinact](https://github.com/suzuki-shunsuke/pinact)                               | `.pinact.yaml`, `.github/workflows/pinact.yml` |
| Dependency bumps  | Dependabot                                                                        | `.github/dependabot.yml`                       |
| CI / Release      | GitHub Actions                                                                    | `.github/workflows/ci.yml`, `publish.yml`      |

## Getting started

```bash
mise install       # install node, pnpm, actionlint, pinact
pnpm install       # install dependencies and set up the pre-commit hook
pnpm cicheck       # run everything CI runs
```

## Scripts

| Script                 | Description                                               |
| ---------------------- | --------------------------------------------------------- |
| `pnpm build`           | Build ESM + CJS bundles and type declarations into `dist` |
| `pnpm check`           | `fmt:check` + `oxlint` + `typecheck`                      |
| `pnpm cicheck`         | `cicheck:code` + `cicheck:content` — what CI runs         |
| `pnpm cicheck:code`    | `check` + `test`                                          |
| `pnpm cicheck:content` | `cspell` + `secretlint`                                   |
| `pnpm fix`             | Auto-fix formatting and lint problems                     |
| `pnpm generate`        | Regenerate AI tool configs from `.rulesync/`              |
| `pnpm knip`            | Report unused files, exports, and dependencies            |
| `pnpm test`            | Run the test suite                                        |
| `pnpm test:coverage`   | Run the test suite with coverage                          |
| `pnpm typecheck`       | Type-check without emitting                               |

## mise tasks

| Task                    | Description                                      |
| ----------------------- | ------------------------------------------------ |
| `mise run actionlint`   | Lint GitHub Actions workflows                    |
| `mise run pinact`       | Pin actions in workflows to full commit SHAs     |
| `mise run pinact:check` | Fail if any action is not pinned to a commit SHA |

## Supply chain hardening

- `.npmrc` sets `save-exact=true`, so every dependency is pinned to an exact version.
- `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so a version published less than a day ago is
  refused — a compromised release has time to be pulled before it reaches a lockfile.
- Postinstall scripts are blocked by default via `allowBuilds`; add a package there only when a build
  step is genuinely required. CI installs with `--ignore-scripts`.
- Every third-party GitHub Action is pinned to a full-length commit SHA, enforced by `pinact` in CI.
- Workflows declare the narrowest `permissions:` block they need.
- `secretlint` runs over every staged file through lint-staged, and over the whole tree in CI.

## AI coding agent rules

Rules live in `.rulesync/` and are compiled into each tool's native format by `pnpm generate`:

- `.rulesync/rules/*.md` — instructions (overview, coding, testing, GitHub Actions security)
- `.rulesync/mcp.json` — MCP servers
- `.rulesync/hooks.json` — session hooks
- `.rulesync/permissions.jsonc` — per-tool permission settings
- `rulesync.jsonc` — which tools to generate for (Claude Code, Codex CLI, GitHub Copilot, opencode)

Generated files (`AGENTS.md`, `CLAUDE.md`, `.claude/`, `.github/instructions/`, …) are gitignored —
edit `.rulesync/**` instead, never the generated output.

## Publishing

`.github/workflows/publish.yml` publishes to npm when a `v*.*.*` tag is pushed. It verifies the tag
matches `package.json`'s version, runs `pnpm cicheck`, builds, and publishes via
[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC — no npm token in secrets).
Configure the trusted publisher on npm before the first release.

## License

[MIT](./LICENSE)
