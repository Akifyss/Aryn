import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createArynPaths } from '../electron/main/aryn-paths'

describe('Aryn data paths', () => {
  it('resolves all application state paths from one root directory', () => {
    const paths = createArynPaths({
      appName: 'Aryn',
      documentsDir: 'C:/Users/me/Documents',
      homeDir: 'C:/Users/me',
      legacyUserDataDir: 'C:/Users/me/AppData/Roaming/Aryn',
      publicDir: 'C:/app/public',
      tempDir: 'C:/Users/me/AppData/Local/Temp',
    })

    expect(paths.arynDataDir).toBe(path.join('C:/Users/me', '.aryn'))
    expect(paths.appStatePath).toBe(path.join(paths.arynDataDir, 'app-state.json'))
    expect(paths.workspaceStatePath).toBe(path.join(paths.arynDataDir, 'workspace-state.json'))
    expect(paths.conversationIndexPath).toBe(path.join(paths.arynDataDir, 'conversations', 'index.json'))
    expect(paths.piAgentDir).toBe(path.join(paths.arynDataDir, 'agents', 'pi'))
    expect(paths.workspaceIconThemeCacheDir).toBe(path.join('C:/Users/me/AppData/Local/Temp', 'Aryn', 'workspace-icon-themes'))
    expect(paths.bundledWorkspaceIconThemeDirectoryPath).toBe(path.join('C:/app/public', 'icon-themes'))
    expect(paths.legacyAppStatePaths).toEqual([
      path.join('C:/Users/me/AppData/Roaming/Aryn', 'app-state.json'),
      path.join('C:/Users/me/AppData/Roaming/Aryn', 'workspace-settings.json'),
    ])
  })

  it('does not invent legacy paths when Electron userData is unavailable', () => {
    const paths = createArynPaths({
      appName: 'Aryn',
      documentsDir: '/home/me/Documents',
      homeDir: '/home/me',
      legacyUserDataDir: null,
      publicDir: '/app/public',
      tempDir: '/tmp',
    })

    expect(paths.legacyAppStatePaths).toEqual([])
  })
})
