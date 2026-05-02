# Meo Performance Standard

This document defines the minimum performance standard for Meo editor changes,
especially live editing and diff split mode. The goal is to catch regressions
before they reach manual testing, and to make performance reviews comparable
across changes.

## Current Coverage

The repository already has performance guards in
`test/meo-performance.spec.ts`. They are useful, but they are guard tests, not a
complete benchmark suite. They currently cover:

- Long plain Markdown documents with 12,000 lines.
- Optional syntax scanners staying token-gated and cheap.
- Live typing and IME composition avoiding full decoration rebuilds.
- Active split find/search highlights staying mapped during live typing and
  refreshing after the deferred find-status pass.
- Split diff gutter flags staying deferred until explicit refresh.
- Split merge chunk updates avoiding full document flattening on incremental
  paths.
- Split merge live input/delete/IME choosing the deferred chunk path.
- Deletion chunks staying bounded to the edited line on the local incremental
  path.

The related correctness tests are part of the Meo performance standard because
performance optimizations can break behavior:

- `test/meo-git-diff-gutter.spec.ts`
- `test/git-diff-navigation.spec.ts`

## Commands

Run the quick guard set while developing Meo editor changes:

```sh
npm run perf:meo
```

Run the full gate before committing performance-sensitive editor or diff changes:

```sh
npm run perf:meo:full
```

`perf:meo:full` runs TypeScript checking and then the Meo performance-related
test set through the normal `npm test` path, including the project pretest
build.

## Required Review Standard

Any change touching these areas must be evaluated against this standard:

- `src/features/editor/lib/meo-native-diff-split.ts`
- `src/vendor/codemirror-merge/src/*`
- `src/vendor/meo/webview/liveMode.ts`
- `src/vendor/meo/webview/helpers/gitDiffGutter.ts`
- `src/vendor/meo/webview/helpers/*` scanners used by live editing
- CodeMirror transaction handlers, decorations, gutters, overview rulers,
  spacers, and diff navigation.

For these changes, the review must answer:

- Does normal typing stay out of O(document) scans?
- Does deletion stay out of O(document) scans?
- Does IME composition stay out of diff, gutter, and decoration recompute paths?
- Are expensive recomputes scheduled after idle time instead of inside the
  input transaction?
- Are stale cached artifacts either frozen/mapped or refreshed before use?
- Do chunk-sensitive commands refresh before reading chunks?
- Does any new `doc.toString()` or full-line traversal run in a hot input path?
- If find/search state is active, are existing match decorations mapped during
  live input instead of rebuilding from a full document scan?
- Does the change keep behavior correct for hunk actions, navigation, undo,
  redo, external sync, and read-only updates?

## Performance Budgets

The guard tests use deliberately coarse budgets because CI and local machines
vary. These budgets are regression tripwires, not product latency goals.

Live input transaction budget:

- 12,000-line document.
- Typing, deletion, and IME composition should complete under 100 ms in the
  unit-level guard environment.
- The transaction must not rebuild full live decorations, recompute git diff
  flags, rebuild merge chunks, or flatten whole documents.

Deferred refresh budget:

- Expensive diff artifacts may refresh after the idle debounce.
- Split diff uses a 200 ms idle refresh delay and an 80 ms post-composition
  refresh delay.
- Refresh may rebuild chunks and gutter flags, but must not run during IME
  composition.

Scanner budget:

- Optional Markdown feature scanners over a 12,000-line plain document must
  finish under 500 ms.
- Scanners should be token-gated when possible, and should avoid full syntax or
  text scans unless a trigger token is present.

Correctness budget:

- Performance optimizations must not remove highlights merely to hide work.
- Existing visible diff decorations should be mapped or preserved until the
  deferred refresh produces the next authoritative diff.
- Stale chunks must not be used to apply hunk actions.

## Adding New Tests

Add or update `test/meo-performance.spec.ts` when a change introduces a new hot
path, cache, debounce, or deferred update. A good performance guard should do at
least one of these:

- Prove the hot transaction reuses the old artifact until explicit refresh.
- Monkey-patch `Text.toString()` to fail if a hot path flattens the document.
- Make an expensive callback throw if the hot path should not call it.
- Exercise a 12,000-line document with a small local edit.
- Cover IME composition separately from normal typing.
- Pair a performance guard with a behavior assertion.

Use deterministic synthetic documents in unit tests. Do not assert tight
millisecond thresholds unless the test also proves the algorithmic behavior.

## Benchmarking Guidance

For manual before/after measurements:

- Use the same machine, same Node version, same branch base, and same working
  tree shape.
- Close the dev server and Electron window unless the scenario requires them.
- Warm the command once, then record at least five runs.
- Compare median and worst run, not a single sample.
- Treat a change as suspicious if median time regresses by more than 20%, even
  when guard tests still pass.

For interactive Meo diff split checks, use this scenario:

- 12,000-line Markdown document.
- One modified line in the middle and one edit near the viewport.
- Type the first changed character.
- Delete the last changed character.
- Use IME composition and cancel/commit.
- Trigger next/previous change and a hunk action after a pending edit.

The expected behavior is that typing stays responsive, red/green split
backgrounds do not expand to unrelated lines, and visible diff artifacts update
after the deferred refresh rather than on every input transaction.
