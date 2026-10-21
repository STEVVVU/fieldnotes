# Fieldnotes

Fieldnotes is a fork of Trilium. Preserve upstream attribution, the root AGPLv3 license and the web clipper's GPLv3 license. Root `CLAUDE.md` and the relevant `.claude/skills/` files document the inherited architecture and conventions. User instructions take precedence.

Use Node 24.22.0 and pnpm 12.14.0. Install with `pnpm install --frozen-lockfile`. Keep the lockfile and the upstream workspace overrides intact.

Run the narrowest relevant Vitest specs. The initial clipper baseline is `pnpm --filter web-clipper test --run --coverage`; its configured thresholds are 100%. Server clipper baseline is `pnpm --filter server test --run src/routes/api/clipper.spec.ts`. Run root `pnpm typecheck` after a completed implementation unit. Do not run the upstream ESLint commands, which the upstream instructions identify as out of memory.

Before product changes, use `.agents/skills/verify-fieldnotes/SKILL.md`. Its maintained driver is `tools/verify-fieldnotes-server.mjs`; generated evidence stays under ignored `.audit/verification/`. Never launch against the user's Trilium data or disable authentication. Browser tests use CUA. Installed-extension and native Electron proof are distinct from web UI or mocked API tests.

Native Electron verification can reuse upstream's Electron test integration on the dedicated hosted Mac through `tools/verify-fieldnotes-native.mjs`. Its host guard must remain enforced. This does not authorize local native automation or replace CUA for browser observations.

Push only to the user's fork. Keep the original remote named `upstream`. Do not create release tags or trigger extension-store submissions. Commit only explicit paths, with accurate current dates and authorship.
