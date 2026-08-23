# bb session surface vendoring

This package vendors the conversation timeline renderer from
[`get-bb/bb`](https://github.com/get-bb/bb) under its MIT license.

## Pinned upstream

- Repository: `https://github.com/get-bb/bb.git`
- Commit: `5205d98a74ed5a22469e521cf1f86b00b8232827`
- License: MIT; the upstream license is retained as `LICENSE`
- Integrity manifest: `vendor-manifest.json`

The files below `src/upstream/bb/` are mechanical copies and must not be edited
by hand. `scripts/verify-bb-session-surface-upstream.mjs` verifies every copied
file against the recorded SHA-256 digest.

The pinned slice currently contains 274 exact upstream files: an upstream
dependency surface rather than an entire bb application checkout. It keeps all 57 TypeScript files in
`packages/thread-view/src` as one event-to-timeline unit, plus the complete
local dependency closure of the `packages/client-core/src` timeline, diff, and
prompt modules consumed by the embedded view. Unrelated client-core composer,
sidebar, panel, terminal, and desktop-transport modules are intentionally out
of scope. The slice also keeps bb's exact bottom-scroll anchor,
scroll-to-latest control, windowed timeline, streaming Markdown, math, and lazy
diff-rendering dependencies.

## Aryn boundary

The vendored surface owns the scrollable conversation timeline, including the
in-timeline presentation of permission and question lifecycles. Aryn continues
to own the session threadbar, composer, native agent lifecycle, persistence,
transport, and the actual permission/question responses.

Provider-native snapshots remain the source of truth. The files in
`src/projectors/` adapt each provider into bb `ThreadEventWithMeta` values for
all four Aryn entries. The exact vendored `@bb/thread-view` package then owns
event ordering, turn grouping, streaming buffers, lifecycle aggregation, and
`TimelineRow` construction:

- `builtin-pi` (Aryn / PI backend)
- `pi`
- `opencode`
- `codex`

Anything that cannot be represented safely remains a canonical
`provider/unhandled` event for diagnostics. Matching bb's default application
behavior, those raw provider payloads are not rendered in the user-facing
timeline. The bb surface is Aryn's only provider-session rendering path; the
former provider-specific surfaces and view selector were removed after the
unified projection reached parity.

## Exact code and compatibility code

- `src/upstream/bb/**`: exact upstream source and styles.
- `src/compat/**`: Aryn host adapters for bb application services that are not
  part of the timeline itself (routing, clipboard, theme, plugin slots, and
  query placeholders). `compat/client-core.ts` deliberately exposes only the
  exact upstream modules reached by the embedded timeline; the vendor script
  preserves their complete local dependency closure without pulling bb's
  unrelated composer, sidebar, panel, terminal, and transport code into Aryn.
- `src/projectors/**`: Aryn provider snapshot to bb canonical event adapters.
- `src/index.tsx`: the isolated mount boundary used by the Electron renderer.
- `vite.config.ts`: build isolation, import aliases, and CSS scoping.

The package is built as an isolated browser bundle so bb's React and styling
dependencies do not become application-wide UI dependencies. All emitted CSS
is scoped to `.aryn-bb-session-surface` or the package's portal root.

## Refresh procedure

1. Clone or fetch `get-bb/bb` and check out the intended commit.
2. Deliberately update `PINNED_COMMIT` in
   `scripts/vendor-bb-session-surface.mjs` after reviewing the upstream diff.
3. Run `node scripts/vendor-bb-session-surface.mjs <path-to-bb-clone>`.
4. Run `node scripts/verify-bb-session-surface-upstream.mjs`.
5. Run the package typecheck, tests, build, and CSS-scope verification.
6. Review the Aryn provider projection fixtures and the shared host fallback
   used when a provider snapshot is unavailable.

Upstream refreshes are intentionally explicit. Aryn does not track bb's main
branch automatically.
