# 0001 · Electron desktop and Linux packaging

## Decision

Use Electron with strict TypeScript, one npm package, and a committed lockfile.
Use the TypeScript compiler and bundled static assets. The sandboxed renderer
uses a narrow preload API. The main process opens the native folder picker
and handles writes through the project registry. The packaged app serves
its renderer assets over a private Electron protocol.

Start with an x86-64 Debian package and Ubuntu as the first target. Use
electron-builder for the desktop entry and packaging, and Playwright for
window-level smoke tests. CI uses the same npm commands as local development
and retains the Debian artifact after verification.

Store the M01 registry in a versioned owner-readable JSON file under
Electron's user-data directory. Serialize writes and replace the file
atomically. Use the resolved directory to detect aliases and a generated ID
as durable project identity. Decide notebook storage and legacy import in M03.

## Sources

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron native dialog API](https://www.electronjs.org/docs/latest/api/dialog)
- [Playwright Electron API](https://playwright.dev/docs/api/class-electron)
