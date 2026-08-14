import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('agent session loading state', () => {
  it('retains the committed surface during the 200ms grace period and commits the snapshot immediately', async () => {
    const [composerSource, navigationSource, sidebarSource, surfaceSource, promptSource] = await Promise.all([
      readSource('../src/features/agent/components/agent-composer-surface/agent-composer-surface.tsx'),
      readSource('../src/features/agent/hooks/use-agent-session-navigation.ts'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx'),
      readSource('../src/features/agent/components/agent-new-conversation-prompt/agent-new-conversation-prompt.tsx'),
    ])

    const cacheRead = navigationSource.indexOf('getCachedAgentSessionSnapshot(agentId, workspacePath, sessionPath)')
    const cachedSnapshotCommit = navigationSource.indexOf('setViewedSessionSnapshot(cachedSnapshot)')
    const loadingStart = navigationSource.indexOf('setIsSessionSnapshotLoading(true)')
    const delayedIndicatorStart = navigationSource.indexOf('loadingIndicator.begin()', loadingStart)
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
    expect(delayedIndicatorStart).toBeGreaterThan(loadingStart)
    expect(surfacePreload).toBeGreaterThan(-1)
    expect(surfacePreload).toBeLessThan(sessionRead)
    expect(sessionRead).toBeGreaterThan(loadingStart)
    expect(surfaceReady).toBeGreaterThan(sessionRead)
    expect(surfaceReady).toBeLessThan(presentationCommit)
    expect(presentationCommit).toBeGreaterThan(sessionRead)
    expect(snapshotCommit).toBeGreaterThan(presentationCommit)
    expect(historyRead).toBeGreaterThan(snapshotCommit)
    expect(loadingEnd).toBeGreaterThan(snapshotCommit)
    expect(navigationSource).toMatch(/if \(!canPresentCachedSnapshot\) \{\s*syncActiveSessionSelection\(fallbackPresentation\.selection\)\s*setSelectedAgentIdValue\(fallbackPresentation\.agentId\)\s*syncSessionPresentation\(fallbackPresentation\)/)
    expect(navigationSource).toMatch(/finally \{\s*if \(requestId === openSessionRequestIdRef\.current\) \{\s*loadingIndicator\.finish\(\)\s*setIsSessionSnapshotLoading\(false\)/)
    expect(sidebarSource).toContain('activeSessionSelection: sessionPresentation.selection')
    expect(sidebarSource).toContain('selectedAgentId: sessionPresentation.agentId')
    expect(sidebarSource).toContain('activeSessionPath: selectedSessionPath')
    expect(sidebarSource).toContain('visibleSessionPath: activeSessionPath')
    expect(sidebarSource).toMatch(/const isSessionLoading = isSessionSnapshotLoading \|\| isWorkspaceSessionLoading/)
    expect(sidebarSource).toMatch(/const showSessionLoadingIndicator = showSessionSnapshotLoadingIndicator\s*\|\| isWorkspaceSessionLoading/)
    expect(sidebarSource).toMatch(/const canSend = Boolean\([\s\S]*?&& !isSessionLoading/)
    expect(composerSource).toMatch(/disabled=\{[\s\S]*?\|\| isSessionLoading/)
    expect(composerSource).toContain('getAgentDefinition(visibleAgentId).label')
    expect(composerSource).toContain('isViewingActiveRuntime,')
    expect(surfaceSource).toContain("import { AppLoadingState } from '@/components/app-loading-state'")
    expect(surfaceSource).toMatch(/showSessionLoadingIndicator \? \([\s\S]*?<AppLoadingState[\s\S]*?\) : isNewConversation \? \(/)
    expect(surfaceSource).toContain('activeSessionPath={visibleSessionPath}')
    expect(promptSource).toContain("visibleSessionSelection.kind === 'session'")
    expect(promptSource).toContain('selectedAgentId={visibleAgentId}')
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
})
