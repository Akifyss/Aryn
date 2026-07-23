import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { ActiveWorkspaceContext } from '../src/features/conversations/types'
import type { ProjectState } from '../src/features/workspace/types'
import { restoreAppBootstrapState } from '../src/hooks/use-app-bootstrap'
import { handleAppKeyboardShortcut } from '../src/hooks/use-app-keyboard-shortcuts'
import { requestAppWindowClose } from '../src/hooks/use-app-window-close'

function createShortcutFixture(overrides: {
  activeTabId?: string | null
  isShortcutBlockingLayerOpen?: boolean
  platform?: NodeJS.Platform
} = {}) {
  return {
    activeTabId: overrides.activeTabId === undefined ? 'tab-1' : overrides.activeTabId,
    closeActiveTab: vi.fn(),
    cycleTabs: vi.fn(),
    isShortcutBlockingLayerOpen: overrides.isShortcutBlockingLayerOpen ?? false,
    onSaveActiveTab: vi.fn(),
    onStartContextualConversation: vi.fn(),
    onToggleCommandPalette: vi.fn(),
    platform: overrides.platform ?? 'win32',
  }
}

function createKeyboardEvent(
  key: string,
  overrides: Partial<{
    altKey: boolean
    ctrlKey: boolean
    metaKey: boolean
    shiftKey: boolean
  }> = {},
) {
  return {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    preventDefault: vi.fn(),
    shiftKey: false,
    ...overrides,
  }
}

describe('application keyboard shortcuts', () => {
  it('uses the platform modifier for the command palette', () => {
    const windowsFixture = createShortcutFixture()
    const windowsEvent = createKeyboardEvent('k', { ctrlKey: true })

    expect(handleAppKeyboardShortcut(windowsEvent, windowsFixture)).toBe(true)
    expect(windowsEvent.preventDefault).toHaveBeenCalledOnce()
    expect(windowsFixture.onToggleCommandPalette).toHaveBeenCalledOnce()

    const macFixture = createShortcutFixture({ platform: 'darwin' })
    const macControlEvent = createKeyboardEvent('k', { ctrlKey: true })
    const macCommandEvent = createKeyboardEvent('K', { metaKey: true })

    expect(handleAppKeyboardShortcut(macControlEvent, macFixture)).toBe(false)
    expect(handleAppKeyboardShortcut(macCommandEvent, macFixture)).toBe(true)
    expect(macFixture.onToggleCommandPalette).toHaveBeenCalledOnce()
  })

  it('blocks contextual conversation creation behind modal layers', () => {
    const blockedFixture = createShortcutFixture({
      isShortcutBlockingLayerOpen: true,
    })
    const blockedEvent = createKeyboardEvent('n', {
      altKey: true,
      ctrlKey: true,
    })

    expect(handleAppKeyboardShortcut(blockedEvent, blockedFixture)).toBe(false)
    expect(blockedFixture.onStartContextualConversation).not.toHaveBeenCalled()

    const activeFixture = createShortcutFixture()
    const activeEvent = createKeyboardEvent('N', {
      altKey: true,
      ctrlKey: true,
    })

    expect(handleAppKeyboardShortcut(activeEvent, activeFixture)).toBe(true)
    expect(activeFixture.onStartContextualConversation).toHaveBeenCalledOnce()
  })

  it('routes editor save, close, and tab navigation shortcuts', () => {
    const fixture = createShortcutFixture()

    handleAppKeyboardShortcut(createKeyboardEvent('s', { ctrlKey: true }), fixture)
    handleAppKeyboardShortcut(createKeyboardEvent('w', { metaKey: true }), fixture)
    handleAppKeyboardShortcut(
      createKeyboardEvent('Tab', { ctrlKey: true, shiftKey: true }),
      fixture,
    )
    handleAppKeyboardShortcut(createKeyboardEvent('PageDown', { ctrlKey: true }), fixture)
    handleAppKeyboardShortcut(createKeyboardEvent('PageUp', { metaKey: true }), fixture)

    expect(fixture.onSaveActiveTab).toHaveBeenCalledOnce()
    expect(fixture.closeActiveTab).toHaveBeenCalledWith('tab-1')
    expect(fixture.cycleTabs.mock.calls).toEqual([[-1], [1], [-1]])
  })

  it('consumes close shortcuts without closing when no tab is active', () => {
    const fixture = createShortcutFixture({ activeTabId: null })
    const event = createKeyboardEvent('w', { ctrlKey: true })

    expect(handleAppKeyboardShortcut(event, fixture)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.closeActiveTab).not.toHaveBeenCalled()
  })
})

function createBootstrapFixture(activeContext: ActiveWorkspaceContext) {
  const projectState: ProjectState = {
    lastProjectId: 'project-1',
    projects: [{
      addedAt: '2026-07-23T00:00:00.000Z',
      id: 'project-1',
      lastFilePath: 'C:\\workspace\\notes.md',
      lastOpenedAt: '2026-07-23T00:00:00.000Z',
      name: 'Workspace',
      path: 'C:\\workspace',
    }],
  }
  const conversationState = {
    conversations: [],
    version: 1,
  }

  return {
    api: {
      getActiveWorkspaceContext: vi.fn(async () => activeContext),
      getConversationState: vi.fn(async () => conversationState),
      getProjectState: vi.fn(async () => projectState),
    },
    conversationState,
    options: {
      connectWorkspace: vi.fn(async () => undefined),
      hydrateConversationState: vi.fn(),
      hydrateProjectState: vi.fn(),
      hydrateWorkspaceIconThemes: vi.fn(async () => undefined),
      restoreInitialConversationContext: vi.fn(async () => false),
      restoreWorkspaceTabs: vi.fn(async () => undefined),
      setActiveWorkspaceContext: vi.fn(),
      setStatusMessage: vi.fn(),
    },
    projectState,
  }
}

describe('application bootstrap restoration', () => {
  it('hydrates persisted state and restores the active project', async () => {
    const fixture = createBootstrapFixture({
      kind: 'project',
      projectId: 'project-1',
    })

    await restoreAppBootstrapState(fixture.api, fixture.options, () => false)

    expect(fixture.options.hydrateProjectState).toHaveBeenCalledWith(fixture.projectState)
    expect(fixture.options.hydrateConversationState).toHaveBeenCalledWith(
      fixture.conversationState,
    )
    expect(fixture.options.connectWorkspace).toHaveBeenCalledWith('C:\\workspace')
    expect(fixture.options.restoreWorkspaceTabs).toHaveBeenCalledWith(
      'C:\\workspace',
      'C:\\workspace\\notes.md',
    )
    expect(fixture.options.setStatusMessage).toHaveBeenLastCalledWith('已恢复上次项目')
  })

  it('lets conversation restoration own conversation contexts', async () => {
    const fixture = createBootstrapFixture({
      conversationId: 'conversation-1',
      kind: 'conversation',
    })
    fixture.options.restoreInitialConversationContext.mockResolvedValue(true)

    await restoreAppBootstrapState(fixture.api, fixture.options, () => false)

    expect(fixture.options.restoreInitialConversationContext).toHaveBeenCalledOnce()
    expect(fixture.options.connectWorkspace).not.toHaveBeenCalled()
    expect(fixture.options.setStatusMessage).not.toHaveBeenCalled()
  })

  it('does not hydrate state after the bootstrap is cancelled', async () => {
    const fixture = createBootstrapFixture({ kind: 'conversationDraft' })
    let cancelled = false
    fixture.options.hydrateWorkspaceIconThemes.mockImplementation(async () => {
      cancelled = true
    })

    await restoreAppBootstrapState(fixture.api, fixture.options, () => cancelled)

    expect(fixture.api.getProjectState).toHaveBeenCalledOnce()
    expect(fixture.options.hydrateProjectState).not.toHaveBeenCalled()
    expect(fixture.options.connectWorkspace).not.toHaveBeenCalled()
  })
})

describe('application window close requests', () => {
  it('deduplicates concurrent close requests and closes after confirmation', async () => {
    let resolveConfirmation: ((confirmed: boolean) => void) | null = null
    const confirmDiscardDirtyTabs = vi.fn(() => (
      new Promise<boolean>((resolve) => {
        resolveConfirmation = resolve
      })
    ))
    const closeWindow = vi.fn(async () => undefined)
    const state = { isInFlight: false }

    const firstRequest = requestAppWindowClose(
      state,
      confirmDiscardDirtyTabs,
      closeWindow,
    )
    const duplicateRequest = requestAppWindowClose(
      state,
      confirmDiscardDirtyTabs,
      closeWindow,
    )

    expect(confirmDiscardDirtyTabs).toHaveBeenCalledOnce()
    expect(state.isInFlight).toBe(true)

    resolveConfirmation?.(true)
    await Promise.all([firstRequest, duplicateRequest])

    expect(closeWindow).toHaveBeenCalledOnce()
    expect(state.isInFlight).toBe(false)
  })

  it('releases the close guard when confirmation is declined', async () => {
    const confirmDiscardDirtyTabs = vi.fn(async () => false)
    const closeWindow = vi.fn(async () => undefined)
    const state = { isInFlight: false }

    await requestAppWindowClose(state, confirmDiscardDirtyTabs, closeWindow)
    await requestAppWindowClose(state, confirmDiscardDirtyTabs, closeWindow)

    expect(confirmDiscardDirtyTabs).toHaveBeenCalledTimes(2)
    expect(closeWindow).not.toHaveBeenCalled()
    expect(state.isInFlight).toBe(false)
  })

  it('releases the close guard when closing the window fails', async () => {
    const closeError = new Error('close failed')
    const state = { isInFlight: false }

    await expect(requestAppWindowClose(
      state,
      async () => true,
      async () => {
        throw closeError
      },
    )).rejects.toBe(closeError)

    expect(state.isInFlight).toBe(false)
  })
})

describe('App lifecycle ownership', () => {
  it('keeps lifecycle listeners and confirmation markup out of App.tsx', async () => {
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')

    expect(appSource).not.toContain("window.addEventListener('keydown'")
    expect(appSource).not.toContain('window.appApi.onWindowCloseRequested')
    expect(appSource).not.toContain('<AlertDialog.')
    expect(appSource).not.toContain("recordOpenFileProfile('lazy:")
    expect(appSource).toContain('useAppBootstrap({')
    expect(appSource).toContain('useAppKeyboardShortcuts({')
    expect(appSource).toContain('useAppWindowClose({')
    expect(appSource).toContain('<AppConfirmDialog')
  })
})
