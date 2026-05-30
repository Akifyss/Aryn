import { mkdirSync } from 'node:fs'
import path from 'node:path'

export type ArynPathInputs = {
  appName: string
  documentsDir: string
  homeDir: string
  legacyUserDataDir: string | null
  publicDir: string
  tempDir: string
}

export type ArynPaths = {
  appStatePath: string
  arynDataDir: string
  bundledWorkspaceIconThemeDirectoryPath: string
  conversationIndexPath: string
  documentsDir: string
  homeDir: string
  legacyAppStatePaths: string[]
  piAgentDir: string
  tempDir: string
  workspaceIconThemeCacheDir: string
  workspaceStatePath: string
}

export function createArynPaths(input: ArynPathInputs): ArynPaths {
  const arynDataDir = path.join(input.homeDir, '.aryn')
  const piAgentDir = path.join(arynDataDir, 'agents', 'pi')
  const legacyAppStatePaths = input.legacyUserDataDir
    ? [
        path.join(input.legacyUserDataDir, 'app-state.json'),
        path.join(input.legacyUserDataDir, 'workspace-settings.json'),
      ]
    : []

  return {
    appStatePath: path.join(arynDataDir, 'app-state.json'),
    arynDataDir,
    bundledWorkspaceIconThemeDirectoryPath: path.join(input.publicDir, 'icon-themes'),
    conversationIndexPath: path.join(arynDataDir, 'conversations', 'index.json'),
    documentsDir: input.documentsDir,
    homeDir: input.homeDir,
    legacyAppStatePaths,
    piAgentDir,
    tempDir: input.tempDir,
    workspaceIconThemeCacheDir: path.join(input.tempDir, input.appName, 'workspace-icon-themes'),
    workspaceStatePath: path.join(arynDataDir, 'workspace-state.json'),
  }
}

export function prepareArynDataDirectories(paths: ArynPaths) {
  try {
    mkdirSync(paths.piAgentDir, { mode: 0o700, recursive: true })
    mkdirSync(path.dirname(paths.conversationIndexPath), { mode: 0o700, recursive: true })
  } catch {
    // Startup can continue; individual stores will surface write errors when needed.
  }
}
