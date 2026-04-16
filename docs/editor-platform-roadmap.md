# Editor Platform Roadmap

## Goal

Build a safe path from today's stable editor stack toward:

- a future VS Code-compatible runtime boundary for extension support
- stronger diff / merge capabilities than the current baseline
- zero regression pressure on the default editor experience

## Current Production Baseline

- Code editing: Monaco standalone
- Git diff editing: CodeMirror Merge
- Principle: keep both paths stable and independently replaceable

This split is intentional. The current Git diff workflow includes block-level stage / unstage / discard actions, editable modified content, autosave, and IME-aware behavior. Those workflow guarantees matter more than matching editor engines.

## Architecture Added In This Phase

- A typed editor-platform abstraction that models:
  - editor runtimes
  - diff engines
  - stable fallbacks
- Persisted settings for:
  - editor runtime choice
  - diff engine choice
- Host components that:
  - read the selected platform setting
  - resolve the effective implementation
  - hard-fallback to stable production implementations when an unavailable option is requested

## Why This Shape

We need future flexibility without letting partial experiments replace the app's stable path.

That means:

- configuration can express future targets now
- runtime resolution always returns a safe implementation
- UI can describe what is stable versus planned
- future experiments can happen behind the host boundary instead of inside the current editor implementation

## Rollout Phases

### Phase 0

Done in this pass:

- introduce platform abstractions
- keep stable defaults
- expose roadmap-aware settings
- preserve safe fallback behavior

### Phase 1

Prepare a VS Code compatibility sandbox without touching the production editor path:

- separate bootstrap module for experimental runtime init
- dedicated feature flag / isolated entry boundary
- explicit diagnostics for runtime boot failures
- controlled file-system service override design

### Phase 2

Add the minimum services required for realistic extension experiments:

- workspace file service bridge
- configuration service mapping
- extension lifecycle boundary
- extension host isolation strategy

### Phase 3

Evaluate higher-level capabilities incrementally:

- web-safe extensions first
- syntax / language extensions before complex UI extensions
- workbench and webview requirements only after host stability is proven

### Phase 4

Revisit stronger diff / merge paths:

- Monaco diff as a lightweight experiment only if workflow gaps can be closed
- VS Code merge / multi-diff only if the compatibility runtime is mature enough
- preserve current CodeMirror Merge path as a fallback until parity is proven

## Non-Goals For The Current Phase

- no direct replacement of the production Monaco editor
- no live extension host wiring in the main path
- no custom editor / webview support yet
- no Git diff engine swap yet

## Decision Rule

Any future runtime or diff experiment must satisfy both:

- isolated activation path
- immediate fallback to today's production implementation
