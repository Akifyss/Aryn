import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentComposerSurface } from '../src/features/agent/components/agent-composer-surface/agent-composer-surface'

const captured = vi.hoisted(() => ({ context: {} as Record<string, unknown> }))
vi.mock('../src/features/agent/components/agent-sidebar/agent-sidebar-context', () => ({ useAgentContext: () => captured.context }))
vi.mock('../src/features/agent/components/agent-model-cascader/agent-model-cascader', () => ({ AgentModelCascader: () => null }))

function render(overrides: Record<string, unknown> = {}) {
  const runtime = { supportedRunningPromptBehaviors: [], steeringMessages: [], followUpMessages: [], hasConfiguredModels: true }
  captured.context = {
    agentState: { runtime }, modelPresentationRuntime: runtime,
    activeWorkspaceContext: { kind: 'conversation', conversationId: 'history' },
    composerAttachments: [], composerState: { value: '', mentions: [] }, workspaceTree: [],
    visibleAgentId: 'pi', visibleWorkspacePath: '/history', workspacePath: '/history',
    isWorkspaceContextPreparing: true, isLoading: true, isSessionLoading: true,
    canUseComposerWithoutWorkspace: false, canUseDraftRuntimeWithoutWorkspace: false,
    isNewConversationSurfaceImmediate: false, isViewingActiveRuntime: false,
    canPerformComposerAction: false, composerAction: 'send',
    ...overrides,
  }
  return renderToStaticMarkup(<AgentComposerSurface localOverlayRoot={null} />)
}
describe('composer editing and runtime readiness', () => {
  it('keeps a historical conversation gated until runtime and snapshot validation finish', () => {
    const html = render()
    expect(html).toContain('contentEditable="false"')
    expect(html).toMatch(/disabled=""[^>]*type="submit"|type="submit"[^>]*disabled=""/)
  })
  it('enables editing and sending when the historical conversation is ready', () => {
    const html = render({ isWorkspaceContextPreparing: false, isLoading: false, isSessionLoading: false, canPerformComposerAction: true })
    expect(html).toContain('contentEditable="true"')
    expect(html).not.toMatch(/disabled=""[^>]*type="submit"|type="submit"[^>]*disabled=""/)
  })
  it.each([
    { isSubmittedComposerPendingPresentation: true },
    { openCodeNativeSession: { parentSessionId: 'parent' } },
    { visibleWorkspacePath: null, workspacePath: null },
  ])('preserves the intentional read-only restriction for %j', (state) => {
    expect(render({ isWorkspaceContextPreparing: false, isLoading: false, isSessionLoading: false, ...state })).toContain('contentEditable="false"')
  })
})
