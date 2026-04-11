# Aryn

Aryn is a desktop AI writing app built with Electron, React, HeroUI, and TypeScript.

## Requirements

- Node.js `22.x`
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
cd <repo-folder>
nvm use || nvm install
npm ci
npm run dev
```

Notes:

- Do not copy `node_modules` from Windows to macOS. Install dependencies again on the Mac.
- `.node-version` and `.nvmrc` both target Node `22`.
- Electron builder is configured with the project app id `com.aryn.desktop`; macOS packaging still needs Apple signing and notarization before release builds are distributed.

## Verification

```bash
npm run typecheck
npm run pretest
npm run test
```
