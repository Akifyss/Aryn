import { describe, expect, it } from 'vitest'
import type { ServerNotification } from '../src/features/agent/codex-protocol/generated/ServerNotification'
import type { Thread } from '../src/features/agent/codex-protocol/generated/v2/Thread'
import { CodexSessionStore } from '../electron/main/codex-session-store'

function thread(turns: Thread['turns'] = []): Thread {
  return {
    agentNickname: null,
    agentRole: null,
    cliVersion: '0.144.1',
    createdAt: 1,
    cwd: 'C:/workspace',
    ephemeral: false,
    forkedFromId: null,
    gitInfo: null,
    id: 'thread-1',
    modelProvider: 'openai',
    name: null,
    parentThreadId: null,
    path: null,
    preview: '',
    recencyAt: null,
    sessionId: 'session-1',
    source: 'appServer',
    status: { type: 'idle' },
    threadSource: 'aryn',
    turns,
    updatedAt: 1,
  }
}

function notify(notification: ServerNotification) {
  return notification
}

describe('Codex native session store', () => {
  it('keeps official Thread/Turn/Item history and client user message IDs intact', () => {
    const store = new CodexSessionStore()
    const snapshot = store.install(thread([{
      completedAt: 2,
      durationMs: 1_000,
      error: null,
      id: 'turn-1',
      items: [{
        clientId: 'optimistic-user-1',
        content: [{ text: 'hello', text_elements: [], type: 'text' }],
        id: 'user-1',
        type: 'userMessage',
      }],
      itemsView: 'full',
      startedAt: 1,
      status: 'completed',
    }]))

    expect(snapshot.thread.turns[0].items[0]).toMatchObject({
      clientId: 'optimistic-user-1',
      id: 'user-1',
      type: 'userMessage',
    })
  })

  it('reconciles legacy event rows with canonical response items from the same turn', () => {
    const store = new CodexSessionStore()
    const snapshot = store.install(thread([{
      completedAt: 2,
      durationMs: 1_000,
      error: null,
      id: 'turn-1',
      items: [
        {
          clientId: 'optimistic-user-1',
          content: [{ text: 'hello', text_elements: [], type: 'text' }],
          id: 'item-1',
          type: 'userMessage',
        },
        {
          id: 'item-2',
          memoryCitation: null,
          phase: 'final_answer',
          text: 'hello back',
          type: 'agentMessage',
        },
        {
          clientId: 'optimistic-user-1',
          content: [{ text: 'hello', text_elements: [], type: 'text' }],
          id: '019f741b-e55d-7832-a0a8-807eca5f320c',
          type: 'userMessage',
        },
        {
          id: 'msg_123',
          memoryCitation: null,
          phase: 'final_answer',
          text: 'hello back',
          type: 'agentMessage',
        },
      ],
      itemsView: 'full',
      startedAt: 1,
      status: 'completed',
    }]))

    expect(snapshot.thread.turns[0].items).toEqual([
      expect.objectContaining({ clientId: 'optimistic-user-1', id: 'item-1', type: 'userMessage' }),
      expect.objectContaining({ id: 'item-2', text: 'hello back', type: 'agentMessage' }),
    ])
  })

  it('does not collapse intentional repeated assistant messages with canonical IDs', () => {
    const store = new CodexSessionStore()
    const snapshot = store.install(thread([{
      completedAt: 2,
      durationMs: 1_000,
      error: null,
      id: 'turn-1',
      items: [
        { id: 'msg_1', memoryCitation: null, phase: 'commentary', text: 'checking', type: 'agentMessage' },
        { id: 'msg_2', memoryCitation: null, phase: 'commentary', text: 'checking', type: 'agentMessage' },
      ],
      itemsView: 'full',
      startedAt: 1,
      status: 'completed',
    }]))

    expect(snapshot.thread.turns[0].items).toHaveLength(2)
  })

  it('preserves normalized items when a canonical completion follows restored legacy history', () => {
    const store = new CodexSessionStore()
    store.install(thread([{
      completedAt: null,
      durationMs: null,
      error: null,
      id: 'turn-1',
      items: [{
        id: 'item-2',
        memoryCitation: null,
        phase: 'final_answer',
        text: 'hello back',
        type: 'agentMessage',
      }],
      itemsView: 'full',
      startedAt: 1,
      status: 'inProgress',
    }]))

    const snapshot = store.apply(notify({
      method: 'item/completed',
      params: {
        item: {
          id: 'msg_123',
          memoryCitation: null,
          phase: 'final_answer',
          text: 'hello back',
          type: 'agentMessage',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
    }))

    expect(snapshot?.thread.turns[0].items).toEqual([
      expect.objectContaining({ id: 'item-2', text: 'hello back', type: 'agentMessage' }),
    ])
  })

  it('buffers events that arrive while history is loading and replays them after hydration', () => {
    const store = new CodexSessionStore()
    store.install(thread())
    const checkpoint = store.beginHydration('thread-1')
    store.apply(notify({
      method: 'turn/started',
      params: {
        threadId: 'thread-1',
        turn: {
          completedAt: null,
          durationMs: null,
          error: null,
          id: 'turn-live',
          items: [],
          itemsView: 'full',
          startedAt: 2,
          status: 'inProgress',
        },
      },
    }))
    store.apply(notify({
      method: 'item/agentMessage/delta',
      params: {
        delta: 'streamed',
        itemId: 'assistant-live',
        threadId: 'thread-1',
        turnId: 'turn-live',
      },
    }))

    const snapshot = store.hydrate(thread(), checkpoint)
    expect(snapshot.status).toEqual({ type: 'busy' })
    expect(snapshot.thread.turns[0]).toMatchObject({ id: 'turn-live', status: 'inProgress' })
    expect(snapshot.thread.turns[0].items[0]).toMatchObject({
      id: 'assistant-live',
      text: 'streamed',
      type: 'agentMessage',
    })
  })

  it('replays a streaming delta exactly once when the same in-progress turn is returned by history', () => {
    const initialTurn: Thread['turns'][number] = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: 'turn-live',
      items: [{
        id: 'assistant-live',
        memoryCitation: null,
        phase: null,
        text: 'before',
        type: 'agentMessage',
      }],
      itemsView: 'full',
      startedAt: 1,
      status: 'inProgress',
    }
    const store = new CodexSessionStore()
    store.install(thread([initialTurn]))
    const checkpoint = store.beginHydration('thread-1')

    store.apply(notify({
      method: 'item/agentMessage/delta',
      params: {
        delta: '-during-read',
        itemId: 'assistant-live',
        threadId: 'thread-1',
        turnId: 'turn-live',
      },
    }))

    const snapshot = store.hydrate(thread([initialTurn]), checkpoint)
    expect(snapshot.thread.turns[0].items[0]).toMatchObject({
      id: 'assistant-live',
      text: 'before-during-read',
      type: 'agentMessage',
    })
  })

  it('does not erase streamed items when a completed turn notification only carries metadata', () => {
    const store = new CodexSessionStore()
    store.install(thread())
    store.apply(notify({
      method: 'turn/started',
      params: {
        threadId: 'thread-1',
        turn: {
          completedAt: null,
          durationMs: null,
          error: null,
          id: 'turn-live',
          items: [],
          itemsView: 'full',
          startedAt: 1,
          status: 'inProgress',
        },
      },
    }))
    store.apply(notify({
      method: 'item/agentMessage/delta',
      params: {
        delta: 'streamed answer',
        itemId: 'assistant-live',
        threadId: 'thread-1',
        turnId: 'turn-live',
      },
    }))

    const snapshot = store.apply(notify({
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          completedAt: 2,
          durationMs: 1_000,
          error: null,
          id: 'turn-live',
          items: [],
          itemsView: 'full',
          startedAt: 1,
          status: 'completed',
        },
      },
    }))!

    expect(snapshot.status).toEqual({ type: 'idle' })
    expect(snapshot.thread.turns[0]).toMatchObject({ id: 'turn-live', status: 'completed' })
    expect(snapshot.thread.turns[0].items[0]).toMatchObject({
      id: 'assistant-live',
      text: 'streamed answer',
      type: 'agentMessage',
    })
  })

  it('does not erase richer in-memory items when history returns the same turn as a skeleton', () => {
    const liveTurn: Thread['turns'][number] = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: 'turn-live',
      items: [{
        id: 'assistant-live',
        memoryCitation: null,
        phase: null,
        text: 'streamed answer',
        type: 'agentMessage',
      }],
      itemsView: 'full',
      startedAt: 1,
      status: 'inProgress',
    }
    const store = new CodexSessionStore()
    store.install(thread([liveTurn]))
    const checkpoint = store.beginHydration('thread-1')

    const skeletonTurn: Thread['turns'][number] = {
      ...liveTurn,
      completedAt: 2,
      durationMs: 1_000,
      items: [],
      status: 'completed',
    }
    const snapshot = store.hydrate(thread([skeletonTurn]), checkpoint)

    expect(snapshot.thread.turns[0]).toMatchObject({ id: 'turn-live', status: 'completed' })
    expect(snapshot.thread.turns[0].items[0]).toMatchObject({
      id: 'assistant-live',
      text: 'streamed answer',
      type: 'agentMessage',
    })
  })

  it('lets an authoritative history read settle stale in-memory running state', () => {
    const runningTurn: Thread['turns'][number] = {
      completedAt: null,
      durationMs: null,
      error: null,
      id: 'turn-live',
      items: [],
      itemsView: 'full',
      startedAt: 1,
      status: 'inProgress',
    }
    const completedTurn: Thread['turns'][number] = {
      ...runningTurn,
      completedAt: 2,
      durationMs: 1_000,
      status: 'completed',
    }
    const store = new CodexSessionStore()
    const runningThread = thread([runningTurn])
    runningThread.status = { type: 'active', activeFlags: [] }
    store.install(runningThread)
    const checkpoint = store.beginHydration('thread-1')

    const completedThread = thread([completedTurn])
    const snapshot = store.hydrate(completedThread, checkpoint)

    expect(snapshot.status).toEqual({ type: 'idle' })
    expect(snapshot.thread.turns[0].status).toBe('completed')
  })

  it('resynchronizes execution state when an authoritative thread is installed', () => {
    const store = new CodexSessionStore()
    store.install(thread())

    const activeThread = thread()
    activeThread.status = { type: 'active', activeFlags: [] }
    expect(store.install(activeThread).status).toEqual({ type: 'busy' })

    expect(store.install(thread()).status).toEqual({ type: 'idle' })
  })

  it('settles a disconnected thread and retains a visible error notice', () => {
    const store = new CodexSessionStore()
    const activeThread = thread()
    activeThread.status = { type: 'active', activeFlags: [] }
    store.install(activeThread)

    const snapshot = store.markDisconnected('thread-1', 'connection lost')!

    expect(snapshot.status).toEqual({ type: 'idle' })
    expect(snapshot.thread.status).toEqual({ type: 'notLoaded' })
    expect(snapshot.notices.at(-1)).toMatchObject({
      kind: 'error',
      message: 'connection lost',
      turnId: null,
    })
  })

  it('settles both native and UI execution state when the App Server closes a thread', () => {
    const store = new CodexSessionStore()
    const activeThread = thread()
    activeThread.status = { type: 'active', activeFlags: [] }
    store.install(activeThread)

    const snapshot = store.apply(notify({
      method: 'thread/closed',
      params: { threadId: 'thread-1' },
    }))!

    expect(snapshot.thread.status).toEqual({ type: 'notLoaded' })
    expect(snapshot.status).toEqual({ type: 'idle' })
  })

  it('streams reasoning, command output, file patches and MCP progress without flattening items', () => {
    const store = new CodexSessionStore()
    store.install(thread([{
      completedAt: null,
      durationMs: null,
      error: null,
      id: 'turn-1',
      items: [
        { content: [], id: 'reason-1', summary: [], type: 'reasoning' },
        {
          aggregatedOutput: null,
          command: 'npm test',
          commandActions: [],
          cwd: 'C:/workspace',
          durationMs: null,
          exitCode: null,
          id: 'command-1',
          processId: null,
          source: 'agent',
          status: 'inProgress',
          type: 'commandExecution',
        },
        { changes: [], id: 'change-1', status: 'inProgress', type: 'fileChange' },
        {
          appContext: null,
          arguments: {},
          durationMs: null,
          error: null,
          id: 'mcp-1',
          pluginId: null,
          result: null,
          server: 'docs',
          status: 'inProgress',
          tool: 'search',
          type: 'mcpToolCall',
        },
      ],
      itemsView: 'full',
      startedAt: 1,
      status: 'inProgress',
    }]))
    const events: ServerNotification[] = [
      { method: 'item/reasoning/summaryPartAdded', params: { itemId: 'reason-1', summaryIndex: 0, threadId: 'thread-1', turnId: 'turn-1' } },
      { method: 'item/reasoning/summaryTextDelta', params: { delta: 'checking', itemId: 'reason-1', summaryIndex: 0, threadId: 'thread-1', turnId: 'turn-1' } },
      { method: 'item/commandExecution/outputDelta', params: { delta: 'passed', itemId: 'command-1', threadId: 'thread-1', turnId: 'turn-1' } },
      {
        method: 'item/fileChange/patchUpdated',
        params: {
          changes: [{ diff: '@@', kind: { move_path: null, type: 'update' }, path: 'src/App.tsx' }],
          itemId: 'change-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
      },
      { method: 'item/mcpToolCall/progress', params: { itemId: 'mcp-1', message: 'Searching', threadId: 'thread-1', turnId: 'turn-1' } },
    ]
    for (const event of events) store.apply(event)

    const snapshot = store.get('thread-1')!
    expect(snapshot.thread.turns[0].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'reason-1', summary: ['checking'], type: 'reasoning' }),
      expect.objectContaining({ changes: [expect.objectContaining({ path: 'src/App.tsx' })], id: 'change-1' }),
    ]))
    expect(snapshot.itemRuntime['command-1'].output).toBe('passed')
    expect(snapshot.itemRuntime['mcp-1'].progress).toEqual(['Searching'])
  })
})
