---
name: verify-fieldnotes
description: Launch and drive Fieldnotes' real Trilium server with an isolated synthetic profile, authenticated HTTP operations, browser observations, durable evidence, and owned-process cleanup.
---

# Verify Fieldnotes

## Launch

Run from the repository root using Node 24.22.0 (`.nvmrc`). Install the locked workspace with pnpm 12.14.0 first. On this Windows checkout the task-local runtime is `.tooling/node_modules/node/bin/node.exe`; it is ignored, not a distributable prerequisite.

```powershell
& .tooling/node_modules/node/bin/node.exe tools/verify-fieldnotes-server.mjs baseline-002 8097
```

Use a new run name. The maintained helper refuses an occupied port or an existing data directory, copies the checked-in synthetic database fixture into `.audit/verification/<run>/data`, starts the actual `apps/server/src/main.ts`, waits for initialized setup status, and authenticates via the public ETAPI. This is a seeded test profile, not proof of the empty-profile setup wizard. Fixture password is `demo1234`, as documented in upstream `apps/server/spec/setup.ts`. No user database is read. Authentication stays enabled. `READY` means the authenticated doctor passed.

## Doctor

Send `doctor` on the helper's stdin. It checks its owned process, initialized application, rejected anonymous ETAPI requests and authenticated `/etapi/app-info`. Inspect the run's `server.log` for failures. Never kill an unrelated listener to free a port.

## Drive

Send `drive` to create and retrieve a text note through production `/etapi/create-note`, `/etapi/notes/:id` and `/etapi/notes/:id/content`. Send `restart` to stop and relaunch the owned server against the same isolated SQLite database, then re-read exact title and content.

Send `evidence` to preserve a synthetic research page through the production clipper HTTP route. The helper serves the owned source on `port + 1`, checks exact snapshot bytes and the manifest through ETAPI, tests identical and changed retries, and asserts the missing image endpoint receives zero requests. `restart` and `verify` re-read this evidence record too. This is real server API proof, not installed-extension proof.

For web observations use CUA, opening the logged loopback URL. Sign into this synthetic fixture with its existing password. Observe the created note in the tree or search and reload it. Drive UI actions through CUA; do not inject page state, run app-internal setters or substitute a DOM fixture for an installed extension.

## Evidence

The helper stores action records and content hashes in `.audit/verification/<run>/result.json`, plus server logs and the retained isolated data. Save CUA screenshots and AX snapshots beside those files. Authentication tokens remain in helper memory and must not be printed, committed, or placed in screenshots. Record the action, resulting content, and persisted side effects. Tests of mocked browser APIs do not prove extension installation or native Electron rendering.

## Cleanup

Send `cleanup`. The helper stops only the process tree it created, checks the listener is gone and writes final cleanup evidence. It retains data and evidence for inspection. Confirm `result.json` and any screenshots still exist after exit. Never delete user profiles or stop another application's processes.

## Helpers

`tools/verify-fieldnotes-server.mjs <unique-run-name> [port]` is a line-oriented real-server driver. Commands are `doctor`, `drive`, `evidence`, `verify`, `restart`, `cleanup`. See [feature map](features/README.md) for proof scope and blocked surfaces.
