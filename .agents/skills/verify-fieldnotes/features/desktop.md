# Desktop application

## Sub-features

Inherited Electron shell, local notes, preload bridge and loopback clipper integration.

## How to get to it (user POV)

Launch the Electron app with separate absolute `TRILIUM_DATA_DIR` and `TRILIUM_ELECTRON_DATA_DIR`. See upstream `.claude/skills/developing-electron-desktop/SKILL.md`.

## Driving it with Electron and CUA

Build with `pnpm --filter desktop build`. For the Windows main-process check, install the official pinned Electron runtime with `node node_modules/electron/install.js`, then run `node tools/verify-fieldnotes-desktop.mjs desktop-001 8099` with a new run name. The maintained driver copies the synthetic fixture into its own profile, launches the actual Electron executable with `--start-hidden`, checks clipper/evidence capability, captures an evidence record, checks refusal of an unrelated Host, stops its owned process tree confirms the record remains in SQLite after shutdown and retains `desktop-result.json` and logs. This passed desktop-002 on 2026-10-20.

Inspect the actual native renderer before claiming a rendering or installation pass. A browser view of the server is web proof. Keep `nodeIntegration` disabled and `contextIsolation` enabled.

## Gotchas

Native app control is not currently exposed by the active CUA surface. Build and IPC tests can provide partial evidence but cannot establish native rendering acceptance.

The hosted-only `tools/verify-fieldnotes-native.mjs` driver targets the actual macOS Electron renderer. It uses the existing upstream Electron test integration, real clipper capture/open routes and the production custom protocol, then checks rendering again after disk-backed restart. The initial Linux sandbox-helper prerequisite failed; no host permissions or sandbox protections were changed. Mac run39525816828 passed launch/doctor/capture/render/shutdown/reopen, exact record retention, original-ID replay and final cleanup. Main inspected the actual reopened PNG. The Windows main-process proof above remains separate; Windows rendering, installer behavior and installed-extension capture remain unverified.
