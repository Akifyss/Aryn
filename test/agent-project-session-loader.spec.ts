import { describe, expect, it, vi } from 'vitest'
import {
  commitAgentProjectSessionLoad,
  getAgentProjectSessionSourceIdsToLoad,
  loadAgentProjectSessionSources,
  markAgentProjectSessionSourcesLoading,
} from '../src/features/agent/lib/project-session-loader'
import {
  flattenAgentProjectSessions,
  selectVisibleAgentProjectSessions,
  storeAgentProjectSessionSource,
  summarizeAgentProjectSessionBucket,
  type AgentProjectSessionBucket,
} from '../src/features/agent/lib/session-tree'
import type { AgentSessionListItem } from '../src/features/agent/types'

function session(id: string): AgentSessionListItem {
  return {
    createdAt: '2026-08-04T00:00:00.000Z',
    id,
    messageCount: 1,
    modifiedAt: '2026-08-04T00:01:00.000Z',
    name: id,
    path: id,
    preview: id,
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, reject, resolve }
}

describe('Agent project session loading transaction', () => {
  it('marks every requested source loading in one immutable bucket update', () => {
    const cachedSession = session('cached-codex')
    const bucket: AgentProjectSessionBucket = {
      hasCompleteSnapshot: false,
      sources: {
        codex: {
          error: 'stale error',
          hasLoaded: false,
          isLoading: false,
          sessions: [cachedSession],
        },
      },
    }

    const loadingBucket = markAgentProjectSessionSourcesLoading(bucket, ['codex', 'opencode'])

    expect(loadingBucket).not.toBe(bucket)
    expect(loadingBucket.hasCompleteSnapshot).toBe(false)
    expect(loadingBucket.sources.codex).toEqual({
      error: null,
      hasLoaded: false,
      isLoading: true,
      sessions: [cachedSession],
    })
    expect(loadingBucket.sources.opencode).toEqual({
      error: null,
      hasLoaded: false,
      isLoading: true,
      sessions: [],
    })
    expect(bucket.sources.codex?.isLoading).toBe(false)
  })

  it('preserves settled state during retry and selects only missing or failed sources', () => {
    const bucket: AgentProjectSessionBucket = {
      hasCompleteSnapshot: true,
      sources: {
        codex: {
          error: null,
          hasLoaded: true,
          isLoading: false,
          sessions: [session('cached-codex')],
        },
        opencode: {
          error: 'OpenCode unavailable',
          hasLoaded: true,
          isLoading: false,
          sessions: [],
        },
        pi: {
          error: null,
          hasLoaded: false,
          isLoading: true,
          sessions: [],
        },
      },
    }

    expect(getAgentProjectSessionSourceIdsToLoad(
      bucket,
      ['builtin-pi', 'pi', 'opencode', 'codex'],
    )).toEqual(['builtin-pi', 'opencode'])

    const retryBucket = markAgentProjectSessionSourcesLoading(bucket, ['opencode'])
    expect(retryBucket.sources.opencode).toEqual({
      error: null,
      hasLoaded: true,
      isLoading: true,
      sessions: [],
    })
    expect(summarizeAgentProjectSessionBucket(retryBucket, ['opencode'])).toEqual({
      errors: [],
      hasCompleteSnapshot: true,
      hasLoaded: true,
      isLoading: true,
    })
  })

  it('waits for out-of-order Agent requests and returns one deterministic result set', async () => {
    const piRequest = deferred<AgentSessionListItem[]>()
    const codexRequest = deferred<AgentSessionListItem[]>()
    const listAgentSessions = vi.fn(({ agentId }: { agentId: string }) => (
      agentId === 'pi' ? piRequest.promise : codexRequest.promise
    ))
    let didResolve = false

    const resultPromise = loadAgentProjectSessionSources(
      ['pi', 'codex'],
      'C:\\workspace\\Aryn',
      listAgentSessions,
    ).then((outcomes) => {
      didResolve = true
      return outcomes
    })

    codexRequest.resolve([session('codex-session')])
    await Promise.resolve()
    expect(didResolve).toBe(false)

    piRequest.reject(new Error('PI unavailable'))
    const outcomes = await resultPromise

    expect(listAgentSessions).toHaveBeenCalledTimes(2)
    expect(outcomes).toEqual([
      { agentId: 'pi', error: 'PI unavailable', sessions: null },
      { agentId: 'codex', error: null, sessions: [session('codex-session')] },
    ])
  })

  it('commits successes and failures together while preserving cached data on failure', () => {
    const cachedPiSession = session('cached-pi')
    const loadingBucket = markAgentProjectSessionSourcesLoading({
      hasCompleteSnapshot: false,
      sources: {
        pi: {
          error: null,
          hasLoaded: false,
          isLoading: false,
          sessions: [cachedPiSession],
        },
      },
    }, ['pi', 'codex'])

    const committedBucket = commitAgentProjectSessionLoad(loadingBucket, [
      { agentId: 'pi', error: 'PI unavailable', sessions: null },
      { agentId: 'codex', error: null, sessions: [session('fresh-codex')] },
    ], ['pi', 'codex'])

    expect(committedBucket.hasCompleteSnapshot).toBe(true)
    expect(committedBucket.sources.pi).toEqual({
      error: 'PI unavailable',
      hasLoaded: true,
      isLoading: false,
      sessions: [cachedPiSession],
    })
    expect(committedBucket.sources.codex).toEqual({
      error: null,
      hasLoaded: true,
      isLoading: false,
      sessions: [session('fresh-codex')],
    })
  })

  it('keeps a runtime source partial until the initial aggregate snapshot commits', () => {
    const snapshotAgentIds = ['pi', 'codex'] as const
    const loadingBucket = markAgentProjectSessionSourcesLoading(undefined, snapshotAgentIds)
    const runtimeBucket = storeAgentProjectSessionSource(
      loadingBucket,
      'pi',
      [session('runtime-pi')],
      snapshotAgentIds,
    )

    expect(runtimeBucket.hasCompleteSnapshot).toBe(false)
    expect(flattenAgentProjectSessions(runtimeBucket)).toEqual([
      expect.objectContaining({ agentId: 'pi', id: 'runtime-pi' }),
    ])
    expect(selectVisibleAgentProjectSessions(runtimeBucket)).toEqual([])

    const committedBucket = commitAgentProjectSessionLoad(runtimeBucket, [
      { agentId: 'pi', error: null, sessions: [session('stale-pi')] },
      { agentId: 'codex', error: null, sessions: [session('loaded-codex')] },
    ], snapshotAgentIds)

    expect(committedBucket.hasCompleteSnapshot).toBe(true)
    expect(selectVisibleAgentProjectSessions(committedBucket).map((item) => item.id)).toEqual([
      'runtime-pi',
      'loaded-codex',
    ])
  })

  it('normalizes synchronous provider failures into the aggregate outcome', async () => {
    const outcomes = await loadAgentProjectSessionSources(
      ['opencode'],
      'C:\\workspace\\Aryn',
      () => {
        throw new Error('OpenCode failed before returning a promise')
      },
    )

    expect(outcomes).toEqual([{
      agentId: 'opencode',
      error: 'OpenCode failed before returning a promise',
      sessions: null,
    }])
  })

  it('does not let a late aggregate response overwrite a newer runtime update', () => {
    const newerSession = session('newer-runtime-session')
    const bucket: AgentProjectSessionBucket = {
      hasCompleteSnapshot: true,
      sources: {
        codex: {
          error: null,
          hasLoaded: true,
          isLoading: false,
          sessions: [newerSession],
        },
      },
    }

    const committedBucket = commitAgentProjectSessionLoad(bucket, [{
      agentId: 'codex',
      error: null,
      sessions: [session('stale-request-session')],
    }], ['codex'])

    expect(committedBucket).toBe(bucket)
    expect(committedBucket.sources.codex?.sessions).toEqual([newerSession])
  })
})
