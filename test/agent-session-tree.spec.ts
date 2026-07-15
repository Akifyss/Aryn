import { describe, expect, it } from 'vitest'
import {
  flattenAgentProjectSessions,
  getAgentSessionTreeKey,
  invalidateAgentProjectSessionBuckets,
  SESSION_TREE_AGENT_IDS,
  summarizeAgentProjectSessionBucket,
  type AgentProjectSessionBucket,
} from '../src/features/agent/lib/session-tree'
import type { AgentSessionListItem } from '../src/features/agent/types'

function source(sessions: AgentSessionListItem[]) {
  return { error: null, hasLoaded: true, isLoading: false, sessions }
}

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
