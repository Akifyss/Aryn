# Electron Debug Workflow

This workflow lets Codex or another AI enter the real Electron app and collect
diagnostics from the renderer and main process.

## Commands

Run against existing `dist/` and `dist-electron/` output:

```powershell
npm.cmd run debug:electron
```

Rebuild first, then run:

```powershell
npm.cmd run debug:electron:build
```

The script launches the app root directory, not `dist-electron/main/index.js`.
This matters because launching the main bundle directly makes Electron resolve
`app.getAppPath()` to `dist-electron/main`, which breaks the preload path.

## Artifacts

Default artifact directory:

```text
tmp/electron-debug-session/
```

Stable files:

- `electron-debug-session-report.json`: structured report.
- `electron-debug-session.log`: step-by-step log.
- `electron-debug-session.png`: screenshot of the final window.

Per-run files:

- `runs/<run-id>/workspace/debug.md`: generated debug workspace file.
- `runs/<run-id>/appdata`: isolated Electron `APPDATA`.
- `runs/<run-id>/localappdata`: isolated Electron `LOCALAPPDATA`.
- `runs/<run-id>/temp`: isolated temp directory.

Each run uses its own `runs/<run-id>/` directory so a failed previous run does
not reuse the same app data or single-instance lock.

## Report Fields

Most useful fields in `electron-debug-session-report.json`:

- `renderer.console`: renderer `console.*` messages.
- `renderer.pageErrors`: uncaught renderer exceptions.
- `renderer.requestFailures`: failed resource requests.
- `renderer.httpErrors`: HTTP 4xx/5xx responses.
- `process.stdout` / `process.stderr`: Electron main process output.
- `snapshot.beforeRestore`: DOM/app state before restoring a workspace.
- `snapshot.afterRestore`: DOM/app state after opening the debug file.

## Environment

Open a custom workspace and file:

```powershell
$env:ARYN_ELECTRON_DEBUG_WORKSPACE="C:\path\to\workspace"
$env:ARYN_ELECTRON_DEBUG_FILE="C:\path\to\workspace\draft.md"
npm.cmd run debug:electron
```

Choose the file view mode. Default is `meo`.

```powershell
$env:ARYN_ELECTRON_DEBUG_VIEW_MODE="default" # default | code | preview | meo
npm.cmd run debug:electron
```

Keep the Electron window open for manual or AI-driven follow-up actions:

```powershell
$env:ARYN_ELECTRON_DEBUG_KEEP_OPEN="1"
$env:ARYN_ELECTRON_DEBUG_KEEP_OPEN_MS="600000"
npm.cmd run debug:electron
```

Increase startup timeout:

```powershell
$env:ARYN_ELECTRON_DEBUG_TIMEOUT_MS="60000"
npm.cmd run debug:electron
```

Change artifact directory:

```powershell
$env:ARYN_ELECTRON_DEBUG_ARTIFACT_ROOT="C:\tmp\aryn-electron-debug"
npm.cmd run debug:electron
```

## AI Debugging Checklist

1. Run `npm.cmd run debug:electron:build` once to verify the app can launch and
   open the generated Markdown file.
2. Read `tmp/electron-debug-session/electron-debug-session-report.json`.
3. If `snapshot.afterRestore.appApiAvailable` is `false`, inspect preload and
   Electron launch path first.
4. If the editor did not open, inspect `snapshot.afterRestore.bodyTextSample`,
   `renderer.pageErrors`, and `renderer.requestFailures`.
5. Use `ARYN_ELECTRON_DEBUG_KEEP_OPEN=1` when a human or an AI needs to keep
   interacting with the live window.
