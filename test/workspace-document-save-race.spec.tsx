import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { useWorkspaceDocumentPersistence } from '../src/features/workspace/hooks/use-workspace-document-persistence'
import { useWorkspaceStore, type WorkspaceDiffTab } from '../src/features/workspace/store/use-workspace-store'
import { createDiffTab } from '../src/features/workspace/lib/workspace-tabs'

vi.mock('@heroui/react', () => ({ toast: { danger: vi.fn() } }))

function controller(activeDiffTab: WorkspaceDiffTab | null) {
  let result!: ReturnType<typeof useWorkspaceDocumentPersistence>
  function Probe() {
    result = useWorkspaceDocumentPersistence({
      activeDiffHasDirtyRelatedFileTab: false, activeDiffTab, activeWorkspaceAutosaveTab: null,
      captureActiveMeoViewPosition: vi.fn(), currentFileContent: '', currentFilePath: null,
      currentPath: null, displayActiveTabId: activeDiffTab?.id ?? null, isActiveEditorComposing: false,
      refreshWorkspaceAfterSave: async () => {}, requestConfirmation: async () => true, setStatusMessage: vi.fn(),
    })
    return null
  }
  renderToStaticMarkup(<Probe />)
  return result
}

afterEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState())
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('saves across retained pane editors', () => {
  it.each(['edit', 'undo', 'unchanged'] as const)('preserves the latest diff and peer file content after %s during a save', async (action) => {
    vi.useFakeTimers()
    let finish!: () => void
    const saveWorkspaceFile = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
    vi.stubGlobal('window', { appApi: { saveWorkspaceFile } })
    const store = useWorkspaceStore.getState()
    const filePath = 'C:/project/file.txt'
    store.openTab({ filePath, content: 'base', editorKind: 'code' })
    const diff = createDiffTab({
      change: { kind: 'modified', originalPath: null, path: filePath, relativePath: 'file.txt', scope: 'unstaged', statusCode: 'M' },
      source: { kind: 'working-tree' }, repositoryRootPath: 'C:/project', selections: [],
      editorKind: 'code', originalContent: 'original', originalExists: true, originalLabel: 'Index',
      modifiedContent: 'base', modifiedExists: true, modifiedLabel: 'Working tree',
    })
    store.openDiffTab(diff)
    store.updateDiffTabDraft(diff.id, 'saving')
    const pending = controller(diff).saveDiffFile(filePath, 'saving')
    expect(saveWorkspaceFile).toHaveBeenCalledWith(filePath, 'saving')
    if (action === 'edit') {
      store.updateDiffTabDraft(diff.id, 'new diff edit')
      store.updateFileTabsContent(filePath, 'new peer edit')
    } else if (action === 'undo') {
      store.updateDiffTabDraft(diff.id, 'base')
    }
    finish()
    await pending
    const tabs = useWorkspaceStore.getState().openTabs
    expect(tabs.find(tab => tab.id === diff.id)).toMatchObject({
      diff: { modifiedContent: 'saving' },
      draftContent: action === 'edit' ? 'new diff edit' : action === 'undo' ? 'base' : null,
      isDirty: action !== 'unchanged',
    })
    expect(tabs.find(tab => tab.kind === 'file')).toMatchObject({
      savedContent: 'saving', content: action === 'edit' ? 'new peer edit' : 'saving', isDirty: action === 'edit',
    })
  })

  it('keeps an undo made while the file save is pending even when it temporarily looks clean', async () => {
    vi.useFakeTimers()
    let finish!: () => void
    vi.stubGlobal('window', { appApi: { saveWorkspaceFile: () => new Promise<void>(resolve => { finish = resolve }) } })
    const store = useWorkspaceStore.getState()
    const filePath = 'C:/project/file.txt'
    store.openTab({ filePath, content: 'base', editorKind: 'code' })
    store.updateFileTabsContent(filePath, 'saving')
    const pending = controller(null).saveWorkspaceFile({ filePath, content: 'saving' })
    store.updateFileTabsContent(filePath, 'base')
    finish()
    await pending
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      content: 'base', savedContent: 'saving', isDirty: true,
    })
  })
})
