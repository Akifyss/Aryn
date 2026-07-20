import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSystemFileManagerName } from '../src/features/agent/lib/system-file-manager'
import {
  flattenAgentProjectSessions,
  formatAgentSessionLabel,
  formatAgentSessionRelativeTime,
  getAgentSessionActivityKey,
  getAgentSessionTreeKey,
  invalidateAgentProjectSessionBuckets,
  normalizeAgentProjectPath,
  SESSION_TREE_AGENT_IDS,
  summarizeAgentProjectSessionBucket,
  type AgentProjectSessionBucket,
} from '../src/features/agent/lib/session-tree'
import type { AgentSessionListItem } from '../src/features/agent/types'

function source(sessions: AgentSessionListItem[]) {
  return { error: null, hasLoaded: true, isLoading: false, sessions }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Agent session tree aggregation', () => {
  it('loads history for every supported Agent independently of CLI availability', () => {
    expect(SESSION_TREE_AGENT_IDS).toEqual(['builtin-pi', 'pi', 'opencode', 'codex'])
  })

  it('keeps sessions from different Agents even when their native paths collide', () => {
    const bucket: AgentProjectSessionBucket = {
      codex: source([{
        createdAt: '2026-07-11T00:00:00.000Z',
        id: 'shared',
        messageCount: 1,
        modifiedAt: '2026-07-11T00:02:00.000Z',
        name: 'Codex session',
        path: 'shared',
        preview: 'Codex session',
      }]),
      pi: source([{
        createdAt: '2026-07-11T00:00:00.000Z',
        id: 'shared',
        messageCount: 1,
        modifiedAt: '2026-07-11T00:01:00.000Z',
        name: 'PI session',
        path: 'shared',
        preview: 'PI session',
      }]),
    }

    expect(flattenAgentProjectSessions(bucket)).toEqual([
      expect.objectContaining({ agentId: 'codex', name: 'Codex session', path: 'shared' }),
      expect.objectContaining({ agentId: 'pi', name: 'PI session', path: 'shared' }),
    ])
    expect(getAgentSessionTreeKey('codex', 'shared')).not.toBe(getAgentSessionTreeKey('pi', 'shared'))
  })

  it('normalizes native paths for stable labels, comparisons, and activity keys', () => {
    const session: AgentSessionListItem = {
      createdAt: '2026-07-11T00:00:00.000Z',
      id: 'nested-session',
      messageCount: 1,
      modifiedAt: '2026-07-11T00:00:00.000Z',
      name: 'folder\\nested/session',
      path: 'nested-session',
      preview: '',
    }

    expect(formatAgentSessionLabel(session)).toBe('folder nested session')
    expect(normalizeAgentProjectPath('C:\\Workspace\\Project\\')).toBe('c:/workspace/project')
    expect(getAgentSessionActivityKey('codex', 'nested-session')).toBe('codex\nnested-session')
  })

  it('reports partial loading and errors without hiding successfully loaded Agents', () => {
    const bucket: AgentProjectSessionBucket = {
      'builtin-pi': source([]),
      codex: { error: null, hasLoaded: false, isLoading: true, sessions: [] },
      opencode: { error: 'OpenCode unavailable', hasLoaded: true, isLoading: false, sessions: [] },
    }

    expect(summarizeAgentProjectSessionBucket(bucket, ['builtin-pi', 'codex', 'opencode'])).toEqual({
      errors: ['OpenCode unavailable'],
      hasLoaded: false,
      isLoading: true,
    })
  })

  it('sorts invalid native timestamps deterministically after valid timestamps', () => {
    const bucket: AgentProjectSessionBucket = {
      codex: source([{
        createdAt: 'invalid',
        id: 'invalid-time',
        messageCount: 0,
        modifiedAt: 'invalid',
        name: 'Invalid timestamp',
        path: 'invalid-time',
        preview: '',
      }]),
      pi: source([{
        createdAt: '2026-07-11T00:00:00.000Z',
        id: 'valid-time',
        messageCount: 0,
        modifiedAt: '2026-07-11T00:00:00.000Z',
        name: 'Valid timestamp',
        path: 'valid-time',
        preview: '',
      }]),
    }

    expect(flattenAgentProjectSessions(bucket).map((session) => session.id)).toEqual([
      'valid-time',
      'invalid-time',
    ])
  })

  it('preserves visible sessions while invalidating sources for a background reload', () => {
    const buckets: Record<string, AgentProjectSessionBucket> = {
      project: {
        codex: source([{
          createdAt: '2026-07-11T00:00:00.000Z',
          id: 'codex-session',
          messageCount: 1,
          modifiedAt: '2026-07-11T00:00:00.000Z',
          name: 'Codex session',
          path: 'codex-session',
          preview: 'Codex session',
        }]),
        opencode: {
          error: 'stale error',
          hasLoaded: true,
          isLoading: false,
          sessions: [],
        },
      },
    }

    const invalidated = invalidateAgentProjectSessionBuckets(buckets)

    expect(invalidated.project?.codex).toEqual({
      error: null,
      hasLoaded: false,
      isLoading: false,
      sessions: buckets.project?.codex?.sessions,
    })
    expect(invalidated.project?.opencode).toEqual({
      error: null,
      hasLoaded: false,
      isLoading: false,
      sessions: [],
    })
    expect(buckets.project?.codex?.hasLoaded).toBe(true)
  })
})

describe('Agent session tree presentation helpers', () => {
  it('formats relative timestamps across supported display ranges', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-21T12:00:00.000Z'))

    expect(formatAgentSessionRelativeTime('invalid')).toBe('')
    expect(formatAgentSessionRelativeTime('2026-07-21T11:59:30.000Z')).toBe('刚刚')
    expect(formatAgentSessionRelativeTime('2026-07-21T11:58:00.000Z')).toBe('2 分')
    expect(formatAgentSessionRelativeTime('2026-07-21T09:00:00.000Z')).toBe('3 小时')
    expect(formatAgentSessionRelativeTime('2026-07-19T12:00:00.000Z')).toBe('2 天')
  })

  it('uses the platform-native file manager name', () => {
    expect(getSystemFileManagerName('darwin')).toBe('访达')
    expect(getSystemFileManagerName('win32')).toBe('资源管理器')
    expect(getSystemFileManagerName('linux')).toBe('文件管理器')
  })
})
