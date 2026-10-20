# Browser capture

## Sub-features

Inherited article, selection, bookmark, screenshot and PDF capture. Fieldnotes' evidence contract is not implemented yet.

## How to get to it (user POV)

Install a built web clipper in a disposable supported browser profile, configure the isolated server and invoke its popup on an owned fixture page.

## Driving it with an installed extension

Build with `pnpm --filter web-clipper build`. A real extension host is required. IAB does not establish installation/control of this MV3 extension. Do not report happy-dom tests, a standalone popup document or HTTP ingestion as installed-extension acceptance.

## Gotchas

Current CUA inventory exposes IAB and MCP Apps only. Actual capture and content-script abuse checks remain blocked until a supported browser with this build loaded is controllable.
