# OpenCode upstream provenance

This package embeds the OpenCode session state and message rendering surface.

- Repository: https://github.com/anomalyco/opencode
- Commit: `9976269ab1accfc9f9dc98a4a688c516934de422`
- OpenCode version: `1.17.18`
- License: MIT

The unmodified source snapshot lives under `src/upstream`. Aryn-specific integration code lives under `src/adapters` and `src/index.tsx`. Keep product adaptations outside the upstream directory so future updates can be reviewed as an upstream diff instead of a hand-maintained fork.

Source layout mapping:

- `src/upstream/app` mirrors the retained files from `packages/app/src`.
- `src/upstream/core` mirrors the retained files from `packages/core/src`.
- `src/upstream/session-ui` mirrors the retained files from `packages/ui/src/session`.
- `src/upstream/ui` mirrors the retained non-session UI styles from `packages/ui/src`.

`test/opencode-upstream-provenance.spec.ts` pins both the complete 162-file
snapshot and the state/message-rendering core. Updating OpenCode requires an
intentional snapshot replacement and corresponding provenance hash update.
