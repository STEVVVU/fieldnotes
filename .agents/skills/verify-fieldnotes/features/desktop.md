# Desktop application

## Sub-features

Inherited Electron shell, local notes, preload bridge and loopback clipper integration.

## How to get to it (user POV)

Launch the Electron app with separate absolute `TRILIUM_DATA_DIR` and `TRILIUM_ELECTRON_DATA_DIR`. See upstream `.claude/skills/developing-electron-desktop/SKILL.md`.

## Driving it with Electron and CUA

Use a task-owned profile and process, never the user's existing Trilium data. Inspect the actual native renderer before claiming a desktop pass. A browser view of the server is only web proof. Keep `nodeIntegration` disabled and `contextIsolation` enabled.

## Gotchas

Native app control is not currently exposed by the active CUA surface. Build and IPC tests can provide partial evidence but cannot establish native rendering acceptance.
