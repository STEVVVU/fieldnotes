# Evidence contract and verification limits

## HTTP contract

Server requests require an ETAPI token in `Authorization`. Electron retains Trilium's separate loopback integration boundary. The route wrappers and authentication policy are inherited; new capture writes use the synchronous transactional wrapper.

| Route | Result |
| --- | --- |
| `GET /api/clipper/evidence-capabilities` | `{ "evidenceCaptureVersion": 1 }` |
| `POST /api/clipper/evidence` | Receipt containing note ID, capture ID, payload hash and attachment IDs |
| `GET /api/clipper/evidence/:captureId` | Receipt, manifest and `verified` or `changed` consistency status |

The version-one request contains exactly `schemaVersion`, `captureId`, `mode`, `sourceUrl`, `title`, `capturedAt`, `extractor`, `content` and `contentSha256`. IDs are 32 lowercase hexadecimal characters. Modes are `article` and `selection`; extractors are `defuddle/0.19.5` and `dom-selection/1`. URLs must be HTTP or HTTPS without embedded credentials. Titles are at most 500 characters, URLs 4096 characters and content 1 MiB of valid UTF-8. Timestamps are canonical ISO UTC strings and are supplied by the capture client. Unexpected metadata fields are rejected.

The server verifies the content digest and hashes a canonical request object. A deterministic note ID provides capture identity. All note, attachment and integrity-label writes occur in one SQLite transaction. An identical request returns the existing receipt. A different payload or a record with changed attachments returns HTTP 409. A repeated capture of the same URL with a new capture ID creates a separate note.

`snapshot.html.txt` preserves the submitted content as an inert UTF-8 text attachment. `evidence-manifest.json` records the capture metadata, receipt time, payload hash, snapshot hash and size, image URLs and the text-conversion step. Images are not downloaded by this route. The readable note removes executable containers and escapes the remaining text. It is not a replay of active HTML.

## Browser transaction

The background owns pending previews, their destinations and the preserved payload. The popup receives a preview but confirms only its ID and content digest. Capability negotiation and the eventual POST both require the prepared destination identity. Discovery cannot silently redirect a pending capture to another server or desktop instance.

The background compares the selected tab's URL and browser document ID before and after extraction, then again before saving. Missing document identity fails closed. Pending captures expire after ten minutes, retain at most eight entries, and disappear when the service worker restarts. DOM edits within the same document do not change the already preserved preview.

A failed or lost save response retains the original capture in the popup. **Retry this capture** uses its original ID, so an already committed save can return its receipt. Closing the popup loses that UI retry state; recapture is a distinct record. This limitation is explicit rather than a claim of durable client-side retries.

Privileged runtime requests require an internal popup or options sender with the extension's ID and exact extension URL, without a tab sender. Content-script requests are denied except for one-use toast grants. Each grant contains its saved action and expires after one minute. It is scoped to the sender's tab, top frame and URL. The broker stores at most 64 grants. Grants disappear with the service worker. Synthetic page click events do not send the toast action.

Connection status and session cache omit server credentials. Chrome sync storage is restricted to trusted extension contexts before discovery reads credentials. When that API is absent, the inherited sync-storage credential behavior remains. No cross-browser credential-isolation guarantee is made.

## Observed acceptance

On Windows with Node 24.22.0 and pnpm 12.14.0:

- The inherited baseline passed 158 clipper tests with 100% configured coverage and 23 existing server clipper tests.
- New clipper checks cover sender authorization, scoped grants, forged commands, digest mismatch, expiry, navigation, missing document IDs, preview retention and destination binding. The combined suite passes 176 tests at the original 100% thresholds.
- HTTP contract tests cover anonymous denial, invalid payloads, exact Unicode content, immutable-by-route retries, changed replays, distinct captures and owner-modified snapshot detection.
- The real server driver copies a synthetic fixture, logs in through ETAPI, preserves a capture, restarts the actual process and reads the same bytes and manifest through production routes. The missing-image fixture records zero server requests. Evidence and the isolated database survive owned-process cleanup.
- Root type checks and both Chrome MV3 and Firefox MV2 builds pass. These are build results, not installation results.
- The Windows desktop bundle builds. The maintained desktop driver launches the real Electron 44.7.2 executable with a copied synthetic profile and `--start-hidden`, preserves and reads an evidence record, verifies HTTP 403 for an unrelated Host and checks that the record remains in SQLite after shutdown. Its process tree and loopback listener stop after the check. This proves main-process startup and the HTTP boundary, not native rendering or packaged installation.

Installed extension behavior, real content-script attack execution, the popup's rendered appearance, native Electron rendering and packaged desktop installation remain unverified. CUA currently exposes IAB and MCP Apps, not a browser hosting this MV3 build or native Electron control. Browser extraction can parse HTML and the inherited rich preview can load resources. The server's zero-fetch result does not establish browser-wide resource isolation.

## Dependency assessment

`pnpm audit --json` initially reported seven advisories. Compatible, pinned updates to Hono 4.13.11, http-cache-semantics 4.3.0 and markdown-it 14.3.2 reduce that result to four. The locked workspace is not audit-clean.

| Remaining dependency | Dependency path and limit |
| --- | --- |
| [uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq), moderate | ExcelJS and Capacitor's Xcode tooling use old versions. The reported flaw concerns buffer bounds in specific UUID variants. No exploitability conclusion for Fieldnotes is established. A major-version override is not validated. |
| [image-size](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), high | The affected 0.7.5 version belongs to the inherited macOS DMG packaging chain. Patched 2.x is a major API change and has not been substituted into unverified macOS packaging. |
| [node-forge](https://github.com/advisories/GHSA-86w9-cpqp-85rv), high | The affected version belongs to web-ext's Android ADB tooling chain. The registry advisory reports no patched version at assessment time. |
| [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), high | The affected version appears in inherited build/watch tooling. The registry advisory reports no patched version at assessment time. |

These paths are dependency inventory findings. They do not establish a running application exploit. No production deployment or extension-store submission was performed.

## Sources

- [Trilium base](https://github.com/TriliumNext/Trilium/commit/8a6ba90e6c9456b3f5552be0122a4972c5c6818b).
- [Carlini, Felt and Wagner, section 5.1](https://www.usenix.org/system/files/conference/usenixsecurity12/sec12-final177_0.pdf), the compromised-content-script experiment used as the research connection.
- [Chrome storage access rules](https://developer.chrome.com/docs/extensions/reference/api/storage).
- [MIT 6.858 Browser Security lab](https://www.css.csail.mit.edu/6.858/2022/labs/lab4.html), a related course exercise, not a completed course claim.
