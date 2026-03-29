# AWA

Desktop writing workspace built with Electron, React, HeroUI, and TypeScript.

## Requirements

- Node.js `22.14.0`
- npm `10+`

## Stack

- Electron
- React
- TypeScript
- electron-vite
- HeroUI
- Tailwind CSS v4
- Zustand
- chokidar

## Current Scope

- Open a local workspace folder
- Render a file tree
- Open text files from the workspace
- Edit and save file content
- Refresh the tree when workspace files change externally

## Development

```bash
npm ci
npm run dev
```

## Continue On macOS

```bash
git clone <repo-url>
cd AWA
nvm use || nvm install
npm ci
npm run dev
```

Notes:

- Do not copy `node_modules` from Windows to macOS. Install dependencies again on the Mac.
- `[.node-version](C:/Users/25672/Desktop/AWA/.node-version)` and `[.nvmrc](C:/Users/25672/Desktop/AWA/.nvmrc)` are both pinned to `22.14.0`.
- Electron builder is configured with the project app id `com.awa.desktop`; macOS packaging still needs Apple signing and notarization before release builds are distributed.

## Verification

```bash
npm run typecheck
npm run pretest
npm run test
```
