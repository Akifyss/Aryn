# T3 Code Codex session surface

This package vendors the production Codex message timeline from
[T3 Code](https://github.com/pingdotgg/t3code) and embeds it as an isolated
surface in Aryn.

- Upstream commit: `7f1cb61031184030653c10d1cb357ba226db90e4`
- Upstream license: MIT (`LICENSE` in this package)
- Vendored on: 2026-07-18

The following files are byte-for-byte copies of the pinned upstream revision:

| Vendored file | Upstream path | SHA-256 |
| --- | --- | --- |
| `src/lib/turnDiffTree.ts` | `apps/web/src/lib/turnDiffTree.ts` | `0481A43667214018A771D522517D443BE73DE90F701164355817758E055A1B65` |
| `src/upstream/t3code/ChangedFilesTree.tsx` | `apps/web/src/components/chat/ChangedFilesTree.tsx` | `60C7EEBFEBFC7606B3131D33C78F0EFDF71856427863A8014CEBC93ED10AA6C5` |
| `src/upstream/t3code/DiffStatLabel.tsx` | `apps/web/src/components/chat/DiffStatLabel.tsx` | `5A29B1A1DEA9650D97BE83597F94EB5B3C77906BF54FA2A3C62922192EF9CBED` |
| `src/upstream/t3code/MessagesTimeline.tsx` | `apps/web/src/components/chat/MessagesTimeline.tsx` | `EF6A1EA795EBB3879EA7F161B07752D342E4709143A585F3806B8D1CCA1C8AD2` |
| `src/upstream/t3code/MessagesTimeline.logic.ts` | `apps/web/src/components/chat/MessagesTimeline.logic.ts` | `476073FA92A7EA65FBD030A96D8C49441D34583EC5D7F0D93292A514A1548820` |
| `src/upstream/t3code/ExpandedImageDialog.tsx` | `apps/web/src/components/chat/ExpandedImageDialog.tsx` | `D69F6439705DA50DACFB670F051711A985B1AC57C08B21C7F2112ED1D5634818` |
| `src/upstream/t3code/ExpandedImagePreview.tsx` | `apps/web/src/components/chat/ExpandedImagePreview.tsx` | `8A34D56939E6EE85A0197143A9BD1BA74A5D953798271AFE16672769EE813BAC` |
| `src/upstream/ui/button.tsx` | `apps/web/src/components/ui/button.tsx` | `FE6BC89C8B14DE0C9EE5809FE23413BBC3C511DED6FEFE83560A0CDAA8346AD4` |
| `src/upstream/ui/tooltip.tsx` | `apps/web/src/components/ui/tooltip.tsx` | `E5256796D7AC9F5FBCC13F2D417A528811D3734930881CBF142FB854966320FB` |

The exact upstream files own timeline row derivation, structural sharing,
settled-turn folding, work-log grouping, streaming indicators, virtualization,
scroll anchoring and the visual message/tool rows. They must not be edited in
place. Upstream updates should replace the complete files and update the pinned
commit and hashes above.

`MessagesTimeline.tsx` imports several T3 application components that cannot be
copied independently without also embedding T3's project store, command bus,
toasts and file-icon services. The following compatibility shims deliberately
remain at the original relative import paths, but are Aryn implementations and
are not represented as byte-for-byte upstream copies:

- `src/upstream/ChatMarkdown.tsx`
- `src/upstream/t3code/MessageCopyButton.tsx`
- `src/upstream/t3code/PierreEntryIcon.tsx`
- `src/upstream/t3code/ProposedPlanCard.tsx`
- `src/upstream/t3code/SkillInlineText.tsx`
- `src/upstream/t3code/TerminalContextInlineChip.tsx`
- `src/upstream/t3code/userMessageTerminalContexts.ts`

The verification script requires every file under `src/upstream` to be listed
as either a pinned exact copy or an explicit compatibility shim. This prevents
future adaptations from being mistaken for unchanged upstream code.

Other Aryn-specific code lives outside `src/upstream`:

- `src/adapter.ts` converts official Codex App Server thread snapshots into the
  T3 Code timeline model without flattening official items into plain text.
- `src/compat` and the small proxy modules provide the T3 Code application
  services that are not part of an embedded session surface. This includes a
  `fast-deep-equal` alias for T3's single `effect/Equal` call, avoiding the
  unrelated Effect runtime dependency while preserving row equality semantics.
- `src/index.tsx` is the mount/update/dispose boundary used by Aryn.
- `src/index.css` maps T3 Code tokens to Aryn tokens. The build scopes every
  selector to `.aryn-codex-session-surface` so the vendored reset and utilities
  cannot change the rest of the application.

The official Codex App Server remains the protocol and persistence authority.
T3 Code is reused for the client-side message timeline and state presentation,
not as a second source of session truth.
