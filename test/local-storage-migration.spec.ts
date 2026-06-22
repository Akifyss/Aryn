import { describe, expect, it } from 'vitest'
import {
  collectLocalStorageMigration,
  removeMigratedLocalStorageKeys,
} from '../src/features/persistence/local-storage-migration'

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()

  get length() {
    return this.data.size
  }

  clear() {
    this.data.clear()
  }

  getItem(key: string) {
    return this.data.get(key) ?? null
  }

  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.data.delete(key)
  }

  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
}

describe('local storage migration', () => {
  it('collects Aryn-owned renderer state and leaves unrelated keys alone', () => {
    const storage = new MemoryStorage()
    const workspacePath = 'C:/Users/me/Documents/project'
    const filePath = `${workspacePath}/draft.md`

    storage.setItem('aryn:settings', JSON.stringify({
      state: {
        agent: {
          runningPromptEnterBehavior: 'steer',
        },
        layoutPreference: 'editor',
        meo: {
          imageFolder: 'images',
        },
        theme: 'dark',
      },
    }))
    storage.setItem('writing-workspace:settings', JSON.stringify({
      state: {
        theme: 'light',
      },
    }))
    storage.setItem('aryn:left-sidebar-width', '348')
    storage.setItem('aryn:agent-chat-width', '456')
    storage.setItem('aryn:agent-right-sidebar-width', '960')
    storage.setItem('aryn:agent-right-sidebar-width-mode', 'fixed')
    storage.setItem('writing-workspace:left-sidebar-width', '280')
    storage.setItem('aryn:right-sidebar-collapsed', 'true')
    storage.setItem('aryn:git-panel-layout', 'tree')
    storage.setItem(`aryn:file-tabs:${encodeURIComponent(workspacePath)}`, JSON.stringify({
      activePath: filePath,
      entries: [
        {
          path: filePath,
          viewMode: 'meo',
        },
      ],
    }))
    storage.setItem(`writing-workspace:file-tabs:${encodeURIComponent(workspacePath)}`, JSON.stringify({
      paths: [`${workspacePath}/legacy.md`],
    }))
    storage.setItem(`aryn:meo-state:${encodeURIComponent(filePath)}`, JSON.stringify({
      mode: 'live',
      topLine: 12,
      viewPositions: {
        live: {
          topLine: 12,
          topLineOffset: 4,
        },
      },
    }))
    storage.setItem('third-party:key', 'keep')

    const snapshot = collectLocalStorageMigration(storage)

    expect(snapshot.migration.settings).toMatchObject({
      agent: {
        runningPromptEnterBehavior: 'steer',
      },
      layoutPreference: 'editor',
      theme: 'dark',
    })
    expect(snapshot.migration.layout).toMatchObject({
      agentChatWidth: 456,
      editorRightSidebarCollapsed: true,
      gitPanelLayout: 'tree',
      leftSidebarWidth: 348,
    })
    expect(snapshot.migration.workspaceTabs?.[workspacePath]).toEqual({
      activePath: filePath,
      entries: [
        {
          path: filePath,
          viewMode: 'meo',
        },
      ],
    })
    expect(snapshot.migration.meoFileStates?.[filePath]).toMatchObject({
      mode: 'live',
      topLine: 12,
    })

    removeMigratedLocalStorageKeys(storage, snapshot.keysToRemove)

    expect(storage.getItem('third-party:key')).toBe('keep')
    expect(storage.getItem('aryn:settings')).toBeNull()
    expect(storage.getItem('writing-workspace:settings')).toBeNull()
    expect(storage.getItem('aryn:left-sidebar-width')).toBeNull()
    expect(storage.getItem('aryn:agent-chat-width')).toBeNull()
    expect(storage.getItem('aryn:agent-right-sidebar-width')).toBeNull()
    expect(storage.getItem('aryn:agent-right-sidebar-width-mode')).toBeNull()
    expect(storage.getItem('writing-workspace:left-sidebar-width')).toBeNull()
    expect(storage.getItem(`aryn:file-tabs:${encodeURIComponent(workspacePath)}`)).toBeNull()
    expect(storage.getItem(`writing-workspace:file-tabs:${encodeURIComponent(workspacePath)}`)).toBeNull()
    expect(storage.getItem(`aryn:meo-state:${encodeURIComponent(filePath)}`)).toBeNull()
  })

  it('ignores malformed JSON state without deleting the only copy', () => {
    const storage = new MemoryStorage()
    const tabKey = `aryn:file-tabs:${encodeURIComponent('C:/broken')}`
    const meoKey = `aryn:meo-state:${encodeURIComponent('C:/broken/file.md')}`

    storage.setItem('aryn:settings', '{')
    storage.setItem(tabKey, '{')
    storage.setItem(meoKey, '{')

    const snapshot = collectLocalStorageMigration(storage)

    expect(snapshot.migration.settings).toBeUndefined()
    expect(snapshot.migration.workspaceTabs).toBeUndefined()
    expect(snapshot.migration.meoFileStates).toBeUndefined()
    expect(snapshot.keysToRemove).not.toContain('aryn:settings')
    expect(snapshot.keysToRemove).not.toContain(tabKey)
    expect(snapshot.keysToRemove).not.toContain(meoKey)
  })

  it('migrates valid legacy settings without deleting malformed current settings', () => {
    const storage = new MemoryStorage()

    storage.setItem('aryn:settings', '{')
    storage.setItem('writing-workspace:settings', JSON.stringify({
      state: {
        theme: 'dark',
      },
    }))

    const snapshot = collectLocalStorageMigration(storage)

    expect(snapshot.migration.settings).toEqual({ theme: 'dark' })
    expect(snapshot.keysToRemove).not.toContain('aryn:settings')
    expect(snapshot.keysToRemove).toContain('writing-workspace:settings')
  })
})
