import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('agent session loading state', () => {
  it('retains the committed surface during the 200ms grace period and commits the snapshot immediately', async () => {
    const [
      composerSource,
      navigationSource,
      sidebarSource,
      surfaceSource,
      surfaceStyles,
      delayedVisibilitySource,
      promptSource,
    ] = await Promise.all([
      readSource('../src/features/agent/components/agent-composer-surface/agent-composer-surface.tsx'),
      readSource('../src/features/agent/hooks/use-agent-session-navigation.ts'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx'),
      readSource('../src/features/agent/components/agent-chat-surface/styles.css'),
      readSource('../src/features/agent/hooks/use-delayed-loading-visibility.ts'),
      readSource('../src/features/agent/components/agent-new-conversation-prompt/agent-new-conversation-prompt.tsx'),
    ])

    const cacheRead = navigationSource.indexOf('getCachedAgentSessionSnapshot(agentId, operationWorkspacePath, sessionPath)')
    const cachedSnapshotCommit = navigationSource.indexOf('setViewedSessionSnapshot(cachedSnapshot)')
    const loadingStart = navigationSource.indexOf('setIsSessionSnapshotLoading(true)')
    const snapshotContentPendingStart = navigationSource.indexOf(
      'setIsSessionSnapshotContentPending(true)',
      loadingStart,
    )
    const surfacePreload = navigationSource.indexOf('void preloadBbSessionSurface().catch(() => undefined)')
    const sessionRead = navigationSource.indexOf('await loadAgentSessionSnapshot({')
    const surfaceReady = navigationSource.indexOf('await preloadBbSessionSurface()', sessionRead)
    const presentationCommit = navigationSource.indexOf('syncSessionPresentation(targetPresentation)', sessionRead)
    const snapshotCommit = navigationSource.indexOf('setViewedSessionSnapshot(immediateSnapshot)')
    const historyRead = navigationSource.indexOf('window.appApi.readAgentSessionInteractionHistory(')
    const loadingEnd = navigationSource.indexOf('setIsSessionSnapshotLoading(false)', snapshotCommit)

    expect(cacheRead).toBeGreaterThan(-1)
    expect(loadingStart).toBeGreaterThan(cacheRead)
    expect(cachedSnapshotCommit).toBeGreaterThan(loadingStart)
    expect(snapshotContentPendingStart).toBeGreaterThan(loadingStart)
    expect(surfacePreload).toBeGreaterThan(-1)
    expect(surfacePreload).toBeLessThan(sessionRead)
    expect(sessionRead).toBeGreaterThan(loadingStart)
    expect(surfaceReady).toBeGreaterThan(sessionRead)
    expect(surfaceReady).toBeLessThan(presentationCommit)
    expect(presentationCommit).toBeGreaterThan(sessionRead)
    expect(snapshotCommit).toBeGreaterThan(presentationCommit)
    expect(historyRead).toBeGreaterThan(snapshotCommit)
    expect(loadingEnd).toBeGreaterThan(snapshotCommit)
    expect(navigationSource).toMatch(/if \(options\.rollbackOnError === false\) \{\s*setViewedSessionSnapshot\(null\)\s*syncSessionPresentation\(targetPresentation\)\s*\} else \{\s*syncActiveSessionSelection\(fallbackPresentation\.selection\)/)
    expect(navigationSource).toMatch(/finally \{\s*if \(requestId === openSessionRequestIdRef\.current\) \{\s*setIsSessionSnapshotLoading\(false\)\s*setIsSessionSnapshotContentPending\(false\)/)
    expect(sidebarSource).toContain('activeSessionSelection: sessionPresentation.selection')
    expect(sidebarSource).toContain('selectedAgentId: sessionPresentation.agentId')
    expect(sidebarSource).toContain('workspacePath: sessionPresentation.workspacePath')
    expect(sidebarSource).toContain('activeSessionPath: selectedSessionPath')
    expect(sidebarSource).toContain('visibleSessionPath: activeSessionPath')
    expect(sidebarSource).toMatch(/const isWorkspaceSessionLoading = Boolean\(\s*isLoading\s*&& activeWorkspaceContext\.kind === 'project'\s*&& !activeProjectSessionRequest/)
    expect(sidebarSource).toMatch(/const isConversationSessionAwaitingSnapshot = Boolean\([\s\S]*?activeWorkspaceContext\.kind === 'conversation'[\s\S]*?&& !visibleSessionSnapshot[\s\S]*?&& !panelError/)
    expect(sidebarSource).toMatch(/const isConversationContextPending = activeWorkspaceContext\.kind === 'conversation'\s*&& !activeConversation/)
    expect(sidebarSource).toMatch(/const hasPendingSessionTransition = isSessionPresentationPending\s*\|\| isSessionSnapshotLoading\s*\|\| isWorkspaceSessionLoading\s*\|\| isConversationSessionAwaitingSnapshot\s*\|\| isConversationContextPending/)
    expect(sidebarSource).toContain('const isSessionLoading = !panelError && hasPendingSessionTransition')
    expect(sidebarSource).toMatch(/const isSessionContentLoading = !panelError && \(\s*isSessionPresentationPending\s*\|\| isSessionSnapshotContentPending\s*\|\| isWorkspaceSessionLoading\s*\|\| isConversationSessionAwaitingSnapshot\s*\|\| isConversationContextPending/)
    expect(sidebarSource).toContain('useDelayedLoadingVisibility(')
    expect(sidebarSource).toContain('sessionTransitionKey,')
    expect(sidebarSource).toMatch(/const showSessionTransitionLoadingIndicator = useDelayedLoadingVisibility\(\s*isSessionContentLoading,\s*sessionTransitionKey,/)
    expect(sidebarSource).toMatch(/const hasVisibleSessionContent = Boolean\([\s\S]*?renderedMessages\.length > 0[\s\S]*?sessionStatus[\s\S]*?shouldShowAgentNewConversationPrompt\(\s*activeWorkspaceContext,\s*sessionPresentation\.selection,/)
    expect(sidebarSource).toContain('shouldShowAgentSessionLoadingIndicator({')
    expect(sidebarSource).toContain('isSessionContentLoading,')
    expect(sidebarSource).toContain('showDelayedLoadingIndicator: showSessionTransitionLoadingIndicator,')
    expect(delayedVisibilitySource).toContain('useLayoutEffect(() => {')
    expect(delayedVisibilitySource).toContain('[active, indicator, transitionKey]')
    expect(delayedVisibilitySource).not.toContain('useEffect(')
    expect(sidebarSource).toMatch(/const canSend = Boolean\([\s\S]*?&& !isSessionLoading/)
    expect(composerSource).toMatch(/disabled=\{[\s\S]*?\|\| isSessionLoading/)
    expect(composerSource).toContain('getAgentDefinition(visibleAgentId).label')
    expect(composerSource).toContain('isViewingActiveRuntime,')
    expect(surfaceSource).toContain("import { AppLoadingState } from '@/components/app-loading-state'")
    expect(surfaceSource).toMatch(/showSessionLoadingIndicator \? \([\s\S]*?<AppLoadingState[\s\S]*?\) : isNewConversation \? \(/)
    expect(surfaceSource).toContain("sessionControlTarget.selection.kind === 'new'")
    expect(surfaceSource).toMatch(/const sessionControlSelection = activeWorkspaceContext\.kind === 'project'\s*\? sessionControlTarget\.selection\s*: visibleSessionSelection/)
    expect(surfaceSource).toContain('const threadbarNewButton = !isSessionControlNewConversation')
    expect(surfaceSource).toContain('disabled={!workspacePath || isWorkspaceContextPreparing}')
    expect(surfaceSource).toContain("activeSession ? formatAgentSessionLabel(activeSession) : '未命名会话'")
    expect(surfaceSource).toContain("label='正在加载会话…'")
    expect(surfaceSource).not.toContain('showConversationEmptyState')
    expect(surfaceSource).not.toContain('这个对话还没有可显示的内容。')
    expect(surfaceStyles).not.toContain('.agent-conversation-empty-state')
    expect(surfaceSource).toContain('activeSessionPath={visibleSessionPath}')
    expect(surfaceSource).toContain('workspacePath={visibleWorkspacePath}')
    expect(navigationSource).toContain('resolveAgentSessionNavigationTarget({')
    expect(navigationSource).toMatch(/const isSessionPresentationPending = Boolean\([\s\S]*?sessionNavigationTarget[\s\S]*?!presentationsMatch\(sessionPresentation/)
    expect(navigationSource).toMatch(/targetProjectPresentationWorkspacePath[\s\S]*?!workspacePathsMatch\(\s*sessionPresentation\.workspacePath/)
    expect(navigationSource).toContain('isSessionPresentationPending,')
    expect(navigationSource).toContain('isSessionSnapshotContentPending,')
    expect(navigationSource).toContain('const sessionTransitionScopeKey = activeWorkspaceContext.kind')
    expect(navigationSource).toContain('const nextNavigationTransitionKey = sessionNavigationTargetKey')
    expect(navigationSource).toContain('sessionTransitionKey,')
    expect(navigationSource).not.toContain('showSessionSnapshotLoadingIndicator')
    expect(navigationSource).toMatch(/const navigationTarget = sessionNavigationTargetRef\.current[\s\S]*?if \(navigationTarget\) \{\s*return/)
    expect(navigationSource).toContain('conversationFallbackPresentationKey')
    expect(navigationSource).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?void handleOpenSession\([\s\S]*?navigationTarget: sessionNavigationTarget/)
    expect(navigationSource).toMatch(/useLayoutEffect\(\(\) => \{\s*const runtimeWorkspacePath = agentState\.runtime\.workspacePath[\s\S]*?syncSessionPresentation/)
    expect(navigationSource).toMatch(/if \(externalSessionRequest\.kind === 'session'\) \{\s*onExternalSessionRequestHandled\?\.\(externalSessionRequest\.requestId\)\s*return/)
    expect(promptSource).toContain("visibleSessionSelection.kind === 'session'")
    expect(promptSource).toContain('selectedAgentId={visibleAgentId}')
  })

  it('presents new-conversation drafts immediately while runtime-dependent actions stay gated', async () => {
    const [
      composerActionsSource,
      composerSource,
      navigationSource,
      sidebarSource,
      workspaceLifecycleSource,
    ] = await Promise.all([
      readSource('../src/features/agent/composer/use-agent-composer-actions.ts'),
      readSource('../src/features/agent/components/agent-composer-surface/agent-composer-surface.tsx'),
      readSource('../src/features/agent/hooks/use-agent-session-navigation.ts'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/runtime/use-agent-workspace-lifecycle.ts'),
    ])

    expect(sidebarSource).toMatch(/shouldShowAgentSessionLoadingIndicator\(\{[\s\S]*?isImmediateNewConversationSurface,[\s\S]*?isSessionLoading,/)
    expect(sidebarSource).toMatch(/const canSend = Boolean\([\s\S]*?&& !isWorkspaceContextPreparing/)
    expect(sidebarSource).toMatch(/const attachmentCapabilityMessage = !isWorkspaceContextPreparing/)
    expect(sidebarSource).toMatch(/const statusMessage = isWorkspaceContextPreparing\s*\? null/)
    expect(sidebarSource).not.toContain('打开工作区以开始。')
    expect(sidebarSource).toContain('canPerformComposerAction,')
    expect(composerActionsSource.match(/if \(!canPerformComposerAction\)/g)).toHaveLength(2)
    expect(composerSource).toContain('!isNewConversationSurfaceImmediate')
    expect(composerSource).toContain('const mentionWorkspacePath = isWorkspaceContextPreparing ? null : workspacePath')
    expect(composerSource).toContain("placeholder={mentionWorkspacePath ? '发送消息，输入 @ 来提及文件…' : '发送消息…'}")
    expect(navigationSource).toContain('useLayoutEffect(() => {')
    expect(navigationSource).toContain('handleStartNewSession(pendingNewSessionProject.path)')
    expect(navigationSource).toContain('isExplicitNewConversationPresentation')
    expect(workspaceLifecycleSource).toMatch(/if \(activeWorkspaceContext\.kind !== 'conversationDraft'\) \{\s*resetComposer\(\)/)
    expect(workspaceLifecycleSource).toMatch(/if \(!isAgentWorkspacePathReadyForTarget\(workspacePath, targetWorkspacePath\)\) \{[\s\S]*?setIsLoading\(false\)\s*return/)
    expect(workspaceLifecycleSource).not.toContain('setViewedSessionSnapshot(null)\n    setHasLoadedWorkspaceState(false)')
    expect(workspaceLifecycleSource).toContain('targetAgentSessionPath === currentSelection.sessionPath')
    expect(workspaceLifecycleSource).toMatch(/if \(nextSelection\.kind === 'new' \|\| runtimeOwnsNextSelection\) \{\s*setViewedSessionSnapshot\(null\)/)
  })

  it('preloads the unified surface and does not add a second visual loading gate', async () => {
    const [loaderSource, mainSource, surfaceSource, timelineSource] = await Promise.all([
      readSource('../src/features/agent/components/bb-session-timeline/bb-session-surface-loader.ts'),
      readSource('../src/main.tsx'),
      readSource('../src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx'),
      readSource('../src/features/agent/components/bb-session-timeline/bb-session-timeline.tsx'),
    ])

    expect(mainSource).toContain('scheduleBbSessionSurfacePreload()')
    expect(mainSource).toContain('scheduleAgentSessionSnapshotCacheWarmup()')
    expect(mainSource).toContain('preloadBbSessionSurfaceResources()')
    expect(loaderSource).toContain('window.requestIdleCallback')
    expect(loaderSource).toContain("'modulepreload'")
    expect(loaderSource).toContain("'preload'")
    expect(surfaceSource).toContain('if (!shouldPreloadUnifiedSurface) return')
    expect(surfaceSource).toContain('void preloadBbSessionSurface().catch(() => undefined)')
    expect(timelineSource).toContain('useLayoutEffect(() => {')
    expect(timelineSource).toContain('getPreloadedBbSessionSurface()')
    expect(timelineSource).not.toContain("import { AppLoadingState } from '@/components/app-loading-state'")
    expect(timelineSource).not.toMatch(/<AppLoadingState[\s\S]*?正在加载会话/)
  })

  it('prefetches conversation rows and scopes visible snapshots to their presentation workspace', async () => {
    const [projectTreeSource, sidebarSource, visibleSessionSource] = await Promise.all([
      readSource('../src/features/agent/components/agent-session-tree/project-tree.tsx'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/hooks/use-agent-visible-session.ts'),
    ])

    expect(projectTreeSource).toMatch(/onPrefetch=\{conversationWorkspacePath && conversationSessionPath[\s\S]*?handlePrefetchSession\(/)
    expect(projectTreeSource).toMatch(/const isCurrentActiveConversationWorkspace = Boolean\([\s\S]*?normalizeAgentProjectPath\(conversationWorkspacePath\)/)
    expect(sidebarSource).toContain('visibleWorkspacePath: sessionPresentation.workspacePath')
    expect(sidebarSource).toMatch(/const runtimeSessionTitle = isViewingActiveRuntime[\s\S]*?agentState\.activeSession\.name/)
    expect(visibleSessionSource).toMatch(/const activeSession = activeSessionPath[\s\S]*?&& runtimeOwnsVisibleWorkspace/)
    expect(visibleSessionSource).toMatch(/runtime\.workspacePath[\s\S]*?activeSessionSnapshot\.workspacePath/)
    expect(visibleSessionSource).toMatch(/viewedSessionSnapshot\?\.sessionPath === activeSessionPath[\s\S]*?viewedSessionSnapshot\.workspacePath/)
  })
})
