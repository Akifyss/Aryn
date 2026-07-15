# Vendored pi-web session surface

- Upstream: <https://github.com/agegr/pi-web>
- Tag: `v0.7.11`
- Commit: `b3bcb4c58eec1c29704e7dbbad5d6904b36f05d7`
- License: MIT (see `LICENSE`)

`src/upstream/pi-web` contains the exact 15 upstream source files used by the
embedded message renderer. Their raw bytes and complete file set are pinned by
the provenance verifier; `.gitattributes` keeps those files on LF so Windows
checkouts do not rewrite the upstream bytes. Aryn imports `MessageView` and its
helpers directly. `src/timeline.tsx` and `src/session-state.ts` are the small
Electron transport adapters extracted from upstream `ChatWindow.tsx` and
`useAgentSession.ts`; they deliberately keep the upstream message model and do
not project it into Aryn's legacy flattened message type.

The build removes only pi-web's Tailwind declaration block (the vendored files
remain unchanged), scopes every emitted selector to
`.aryn-pi-web-session-surface`, and namespaces keyframes. This is required
because pi-web's stylesheet is authored for a whole document while Aryn embeds
it inside an existing Electron renderer.
