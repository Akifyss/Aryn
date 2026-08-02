# bb session surface vendoring

This package vendors the conversation timeline renderer from
[`ymichael/bb`](https://github.com/ymichael/bb) under its MIT license.

## Pinned upstream

- Repository: `https://github.com/ymichael/bb.git`
- Commit: `74d25d1ab6a4dd431f225a67ec9c53f0d8b714d7`
- License: MIT; the upstream license is retained as `LICENSE`
- Integrity manifest: `vendor-manifest.json`

The files below `src/upstream/bb/` are mechanical copies and must not be edited
by hand. `scripts/verify-bb-session-surface-upstream.mjs` verifies every copied
file against the recorded SHA-256 digest.

The pinned slice currently contains 232 exact upstream files. This includes
all 57 TypeScript files in `packages/thread-view/src`; that package is vendored
as a unit so uncommon event types, buffering rules, grouping, and lifecycle
transitions cannot disappear through an import-closure optimization. It also
includes bb's exact bottom-scroll anchor store, scroll-to-latest control, and
mark asset used by that surface.

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

Anything that cannot be represented safely is emitted as an explicit native
event row. It is never silently discarded. The existing native surfaces remain
available through Aryn's view selector and are not modified by this package.

## Exact code and compatibility code

- `src/upstream/bb/**`: exact upstream source and styles.
- `src/compat/**`: Aryn host adapters for bb application services that are not
  part of the timeline itself (routing, clipboard, theme, plugin slots, and
  query placeholders).
- `src/projectors/**`: Aryn provider snapshot to bb canonical event adapters.
- `src/index.tsx`: the isolated mount boundary used by the Electron renderer.
- `vite.config.ts`: build isolation, import aliases, and CSS scoping.

The package is built as an isolated browser bundle so bb's React and styling
dependencies do not become application-wide UI dependencies. All emitted CSS
is scoped to `.aryn-bb-session-surface` or the package's portal root.

## Refresh procedure

1. Clone or fetch `ymichael/bb` and check out the intended commit.
2. Deliberately update `BB_COMMIT` in
   `scripts/vendor-bb-session-surface.mjs` after reviewing the upstream diff.
3. Run `node scripts/vendor-bb-session-surface.mjs <path-to-bb-clone>`.
4. Run `node scripts/verify-bb-session-surface-upstream.mjs`.
5. Run the package typecheck, tests, build, and CSS-scope verification.
6. Review the Aryn provider projection fixtures and the native fallback path.

Upstream refreshes are intentionally explicit. Aryn does not track bb's main
branch automatically.
