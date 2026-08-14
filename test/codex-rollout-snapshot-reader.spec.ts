import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CodexRolloutSnapshotReader } from '../electron/main/agent-host/providers/codex/rollout-snapshot-reader'
import type { CodexThreadRecord } from '../electron/main/agent-host/providers/codex/session-model'

const directories: string[] = []
const originalCodexHome = process.env.CODEX_HOME

afterEach(async () => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = originalCodexHome
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

describe('Codex local rollout snapshot reader', () => {
  it('projects a historical conversation without starting Codex App Server', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-rollout-'))
    directories.push(directory)
    process.env.CODEX_HOME = directory
    const threadId = '019fb9a4-708d-7c63-a256-1e7929bf8a10'
    const sessionDirectory = path.join(directory, 'sessions', '2026', '08', '01')
    await mkdir(sessionDirectory, { recursive: true })
    const rolloutPath = path.join(sessionDirectory, `rollout-2026-08-01T03-26-34-${threadId}.jsonl`)
    await writeFile(rolloutPath, [
      JSON.stringify({ timestamp: '2026-07-31T19:26:40.177Z', type: 'session_meta', payload: {
        cli_version: '0.144.5', cwd: 'C:/workspace', id: threadId, model_provider: 'openai',
        session_id: threadId, source: 'vscode', thread_source: 'aryn', timestamp: '2026-07-31T19:26:34.538Z',
      } }),
      JSON.stringify({ timestamp: '2026-07-31T19:26:40.200Z', type: 'event_msg', payload: {
        started_at: 1_785_525_995, turn_id: 'turn-1', type: 'task_started',
      } }),
      JSON.stringify({ timestamp: '2026-07-31T19:26:41.000Z', type: 'response_item', payload: {
        content: [
          { text: 'hello there', type: 'input_text' },
          { image_url: 'data:image/png;base64,abc', type: 'input_image' },
        ],
        role: 'user', type: 'message',
      } }),
      JSON.stringify({ timestamp: '2026-07-31T19:26:41.500Z', type: 'response_item', payload: {
        arguments: JSON.stringify({ command: 'git status' }), call_id: 'call-1', name: 'shell_command',
        type: 'function_call',
      } }),
      JSON.stringify({ timestamp: '2026-07-31T19:26:41.700Z', type: 'response_item', payload: {
        call_id: 'call-1', output: [{ text: 'clean', type: 'input_text' }], type: 'function_call_output',
      } }),
      JSON.stringify({ timestamp: '2026-07-31T19:26:41.800Z', type: 'response_item', payload: {
        action: { query: 'Codex docs', type: 'search' }, id: 'search-1', status: 'completed', type: 'web_search_call',
      } }),
      JSON.stringify({ timestamp: '2026-07-31T19:26:42.000Z', type: 'response_item', payload: {
        content: [{ text: 'Hello!', type: 'output_text' }], id: 'assistant-1', role: 'assistant', type: 'message',
      } }),
      JSON.stringify({ timestamp: '2026-07-31T19:26:43.000Z', type: 'event_msg', payload: {
        completed_at: 1_785_526_003, duration_ms: 8_000, turn_id: 'turn-1', type: 'task_complete',
      } }),
    ].join('\n'), 'utf8')

    const record: CodexThreadRecord = {
      createdAt: '2026-07-31T19:26:34.669Z', cwd: 'C:/workspace', id: threadId,
      materialized: true, model: 'gpt-5.6-sol', modelExplicit: false, name: null,
      preview: null, reasoningEffort: 'low', rolloutPath, updatedAt: '2026-07-31T19:29:22.164Z',
    }
    const thread = await new CodexRolloutSnapshotReader().read(record)

    expect(thread).toMatchObject({
      cwd: 'C:/workspace', id: threadId, path: expect.stringContaining(threadId),
      preview: 'hello there', status: { type: 'idle' },
    })
    expect(thread.turns).toEqual([
      expect.objectContaining({
        id: 'turn-1', status: 'completed', items: [
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({ text: 'hello there', type: 'text' }),
              expect.objectContaining({ type: 'image', url: 'data:image/png;base64,abc' }),
            ]),
            type: 'userMessage',
          }),
          expect.objectContaining({
            aggregatedOutput: 'clean', command: 'git status', status: 'completed', type: 'commandExecution',
          }),
          expect.objectContaining({ query: 'Codex docs', type: 'webSearch' }),
          expect.objectContaining({ text: 'Hello!', type: 'agentMessage' }),
        ],
      }),
    ])
  })

  it('streams an oversized rollout without dropping messages from the middle', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-large-rollout-'))
    directories.push(directory)
    process.env.CODEX_HOME = directory
    const threadId = '019fb9a4-708d-7c63-a256-1e7929bf8a12'
    const sessionDirectory = path.join(directory, 'sessions', '2026', '08', '01')
    await mkdir(sessionDirectory, { recursive: true })
    const rolloutPath = path.join(sessionDirectory, `rollout-2026-08-01T03-26-34-${threadId}.jsonl`)
    await writeFile(rolloutPath, [
      JSON.stringify({ timestamp: '2026-07-31T19:26:40.177Z', type: 'session_meta', payload: {
        cwd: 'C:/workspace', id: threadId, session_id: threadId,
        timestamp: '2026-07-31T19:26:34.538Z',
      } }),
      JSON.stringify({ padding: 'x'.repeat(4 * 1024 * 1024), type: 'ignored' }),
      JSON.stringify({ timestamp: '2026-07-31T19:26:41.000Z', type: 'response_item', payload: {
        content: [{ text: 'middle message must remain visible', type: 'input_text' }],
        id: 'middle-message', role: 'user', type: 'message',
      } }),
      JSON.stringify({ padding: 'x'.repeat(13 * 1024 * 1024), type: 'ignored' }),
    ].join('\n'), 'utf8')
    const record: CodexThreadRecord = {
      createdAt: '2026-07-31T19:26:34.669Z', cwd: 'C:/workspace', id: threadId,
      materialized: true, model: 'gpt-5.6-sol', modelExplicit: false, name: null,
      preview: null, reasoningEffort: 'low', rolloutPath, updatedAt: '2026-07-31T19:29:22.164Z',
    }

    const thread = await new CodexRolloutSnapshotReader().read(record)

    expect(thread.turns.flatMap((turn) => turn.items)).toContainEqual(expect.objectContaining({
      content: [expect.objectContaining({ text: 'middle message must remain visible' })],
      id: 'middle-message',
      type: 'userMessage',
    }))
  })

  it('rejects a rollout whose header belongs to a different thread or workspace', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-rollout-mismatch-'))
    directories.push(directory)
    process.env.CODEX_HOME = directory
    const threadId = '019fb9a4-708d-7c63-a256-1e7929bf8a10'
    const sessionDirectory = path.join(directory, 'sessions', '2026', '08', '01')
    await mkdir(sessionDirectory, { recursive: true })
    const rolloutPath = path.join(sessionDirectory, `rollout-2026-08-01T03-26-34-${threadId}.jsonl`)
    await writeFile(rolloutPath, JSON.stringify({
      timestamp: '2026-07-31T19:26:40.177Z',
      type: 'session_meta',
      payload: {
        cwd: 'C:/other-workspace',
        id: 'different-thread',
        session_id: 'different-thread',
        timestamp: '2026-07-31T19:26:34.538Z',
      },
    }), 'utf8')
    const record: CodexThreadRecord = {
      createdAt: '2026-07-31T19:26:34.669Z', cwd: 'C:/workspace', id: threadId,
      materialized: true, model: 'gpt-5.6-sol', modelExplicit: false, name: null,
      preview: null, reasoningEffort: 'low', rolloutPath, updatedAt: '2026-07-31T19:29:22.164Z',
    }

    await expect(new CodexRolloutSnapshotReader().read(record))
      .rejects.toThrow('does not match the indexed thread')
  })
})
