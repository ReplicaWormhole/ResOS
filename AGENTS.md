# ResOS repository guidance

## Purpose and status

ResOS is an Electron and TypeScript research IDE with project-scoped Codex
conversations. Read [the spec](docs/SPEC.md) and [the roadmap](docs/ROADMAP.md).
The legacy app is recorded in [the prototype reference](docs/LEGACY.md).

## Commands

- Install dependencies with `npm ci` using the Node version in `.nvmrc`.
- Run the desktop app with `npm start`.
- Run CI's source checks with `npm run check`.
- Format source with `npm run format`.
- Build the Linux package with `npm run package:linux`.
- Run the desktop checks as described in the [README](README.md).

## Coding and verification

- Work in one milestone at a time. Name its requirement IDs and record which
  acceptance checks passed. Update the owning documentation when behavior
  or supported platforms change.
- Keep workspace access, storage, and process control in main-process code
  behind the validated preload boundary. Keep the renderer sandboxed.
- Keep project IDs stable across schema changes. Preserve message revisions
  and source links when adding notebook features.
- Use temporary workspaces and app-data directories in automated tests. Use
  a fake runtime by default. A real Codex check is explicit and uses fixtures.
- Review diffs adversarially and record residual risks. Git ignores
  `node_modules/`, `dist/`, and `release/`. Keep credentials and project data
  outside the repository. Publishing requires a separate release decision.
