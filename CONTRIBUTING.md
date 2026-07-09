# Contributing

See [AGENTS.md](AGENTS.md) for architecture, conventions, and the full development guide. This file covers commit and PR conventions.

## Commit messages & PR titles

This repo uses [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint (locally and in CI) and a PR-title check. [release-please](https://github.com/googleapis/release-please) reads commit history to compute version bumps and generate the changelog, so following this format isn't just style — it's what makes releases work.

Because PRs are squash-merged, **the PR title becomes the commit message on `main`** — that's what release-please actually reads. Give the PR itself a Conventional Commit title; individual commits within the PR are not required to follow the format, though it's good practice.

### Format

```
type(scope): subject
```

- `type` — required, one of the types below
- `scope` — optional but encouraged, one of the scopes below
- `subject` — required, lowercase, no trailing period, imperative mood ("add", not "added"/"adds")

### Types → release bump

| Type | Bump | Appears in changelog |
|---|---|---|
| `feat:` | **minor** (0.x.0) | 🚀 Features |
| `fix:` / `perf:` | **patch** (0.0.x) | 🐛 Fixes |
| `feat!:` / `fix!:` / body with `BREAKING CHANGE:` | **major**\* | ⚠ Breaking |
| `docs:` `chore:` `ci:` `refactor:` `test:` `build:` `style:` `revert:` | none | hidden |

\* Pre-1.0, breaking changes bump **minor** instead of major (`bump-minor-pre-major` in `release-please-config.json`).

### Scopes

`app`, `reporter`, `db`, `ui`, `demo`, `ci`, `docs`, `deps`, `auth`, `ai`, `notifications`, `release`

### Examples

```
feat(reporter): send reporter version with each test run
fix(db): correct null handling in flaky-test aggregation
docs: update configuration reference
ci: add commitlint workflow
feat(auth)!: require email verification before login

BREAKING CHANGE: unverified accounts can no longer sign in.
```

### Enforcement

1. **Local `commit-msg` hook** (husky + commitlint) — runs on every `git commit` after `npm install`. Bypassable with `--no-verify`; treat it as convenience, not a gate.
2. **`Lint commits` CI check** — lints every commit in a PR's range on push.
3. **`Lint PR title` CI check** — lints the PR title itself, since that's what becomes the squash-merge commit subject. This is the check that actually gates `main`.
