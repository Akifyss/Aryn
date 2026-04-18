## MEO Runtime

This directory vendors the prebuilt webview runtime used by the embedded MEO editor.

Source:
- Upstream project: https://github.com/vadimmelnicuk/meo
- Current basis: `vadimmelnicuk.meo-0.1.23.vsix`
- Imported subset: `extension/webview`

Why this exists:
- The app no longer depends on keeping the upstream `.vsix` in the repository.
- Development reads this runtime directly from `vendor/meo-runtime`.
- Production builds copy this runtime into `dist/meo-runtime`, which is then packaged by Electron Builder.

Local project patches:
- `webview/dist/editor-25490d39.js`
  - Adjusted Git gutter click behavior so added lines open the corresponding diff view instead of being treated as non-interactive.

Maintenance notes:
- Treat this directory as a vendored third-party runtime, not app-owned source code.
- If the upstream runtime is updated, replace the vendored files intentionally and re-apply any documented local patches.
- Keep the directory structure stable because the Electron main process serves these files directly.
