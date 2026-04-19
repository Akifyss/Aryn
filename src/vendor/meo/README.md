## MEO vendor runtime

This directory contains a vendored copy of selected source files from
[vadimmelnicuk/meo](https://github.com/vadimmelnicuk/meo), integrated directly
into the renderer instead of loading the packaged VS Code extension webview.

The older `vendor/meo-runtime` packaged webview path has been removed from this
repository. Source-level integration in `src/vendor/meo` is now the single MEO
runtime path.

### Integration shape

- Upstream editor code lives under `src/vendor/meo/webview`.
- Small shared upstream modules live under `src/vendor/meo/shared`.
- App-specific hosting and IPC adaptation must stay outside this folder, in
  `src/features/editor/lib` and `src/features/editor/components`.

### Local patch policy

- Prefer keeping vendor files close to upstream behavior.
- Put Aryn-specific orchestration, persistence, theme bridging, workspace I/O,
  and Electron integration outside the vendor tree.
- If a vendor file must be patched, keep the patch narrow and avoid spreading
  app-specific knowledge through multiple upstream files.

### Current constraints

- Vendor TypeScript files are imported as source and currently use
  `// @ts-nocheck` because upstream source does not match this repository's
  TypeScript settings.
- Styling is bridged through app-owned CSS variables at the top of
  `src/vendor/meo/webview/styles.css`.
- The upstream MEO theme preset/import pipeline is intentionally removed.
  Runtime-editable token values live in `src/vendor/meo/webview/styles.css`.
  `src/vendor/meo/shared/designTokens.ts` only keeps CodeMirror syntax tag
  mapping that cannot be expressed in CSS.

### Maintenance note

If the upstream project is refreshed later, treat `src/features/editor/lib`
as the stable app boundary and minimize changes inside `src/vendor/meo`.
