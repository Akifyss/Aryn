import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('agent session loading state', () => {
  it('covers session snapshot loading before the message surface can render', async () => {
    const [composerSource, navigationSource, sidebarSource, surfaceSource] = await Promise.all([
      readSource('../src/features/agent/components/agent-composer-surface/agent-composer-surface.tsx'),
      readSource('../src/features/agent/hooks/use-agent-session-navigation.ts'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx'),
    ])

    const loadingStart = navigationSource.indexOf('setIsSessionSnapshotLoading(!isActiveRuntimeSession)')
    const sessionRead = navigationSource.indexOf('await window.appApi.readAgentSession(')
    const snapshotCommit = navigationSource.indexOf('setViewedSessionSnapshot(nextSnapshot)')
    const loadingEnd = navigationSource.indexOf('setIsSessionSnapshotLoading(false)', snapshotCommit)

    expect(loadingStart).toBeGreaterThan(-1)
    expect(sessionRead).toBeGreaterThan(loadingStart)
    expect(snapshotCommit).toBeGreaterThan(sessionRead)
    expect(loadingEnd).toBeGreaterThan(snapshotCommit)
    expect(navigationSource).toMatch(/useEffect\(\(\) => \{\s*openSessionRequestIdRef\.current \+= 1\s*setIsSessionSnapshotLoading\(false\)\s*\}, \[workspacePath\]\)/)
    expect(navigationSource).toMatch(/finally \{[\s\S]*?if \(isCurrentRequest\(\)\) \{[\s\S]*?setIsSessionSnapshotLoading\(false\)/)
    expect(sidebarSource).toMatch(/const isSessionLoading = isSessionSnapshotLoading \|\| Boolean\([\s\S]*?isLoading[\s\S]*?activeWorkspaceContext\.kind === 'project'[\s\S]*?externalSessionRequest\?\.kind === 'new'[\s\S]*?activeConversation\?\.agentSessionPath/)
    expect(sidebarSource).toMatch(/const canSend = Boolean\([\s\S]*?&& !isSessionLoading/)
    expect(composerSource).toMatch(/disabled=\{[\s\S]*?\|\| isSessionLoading/)
    expect(surfaceSource).toContain("import { AppLoadingState } from '@/components/app-loading-state'")
    expect(surfaceSource).toMatch(/isSessionLoading \? \([\s\S]*?<AppLoadingState[\s\S]*?label='正在加载会话'[\s\S]*?\) : isNewConversation \? \(/)
  })

  it('keeps the same loading state while the unified message surface mounts', async () => {
    const timelineSource = await readSource(
      '../src/features/agent/components/bb-session-timeline/bb-session-timeline.tsx',
    )

    expect(timelineSource).toMatch(/isLoading \? \([\s\S]*?<AppLoadingState[\s\S]*?label='正在加载会话'/)
  })
})
