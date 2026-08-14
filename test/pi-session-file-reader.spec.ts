import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import { PiSessionFileReader } from '../electron/main/agent-host/sessions/pi-session-file-reader'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )))
})

describe('PiSessionFileReader', () => {
  it('reconstructs the active branch asynchronously and reuses unchanged snapshots', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-reader-'))
    tempDirectories.push(directory)
    const workspacePath = path.join(directory, 'workspace')
    const sessionDirectory = path.join(directory, 'sessions')
    await mkdir(sessionDirectory, { recursive: true })
    const manager = SessionManager.create(workspacePath, sessionDirectory)
    manager.appendMessage({
      content: [{ text: 'First message', type: 'text' }],
      role: 'user',
      timestamp: 100,
    })
    manager.appendMessage({
      api: 'openai-completions',
      content: [{ text: 'First response', type: 'text' }],
      model: 'test-model',
      provider: 'test-provider',
      role: 'assistant',
      stopReason: 'stop',
      timestamp: 150,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    })
    manager.appendSessionInfo('Reader test')
    const sessionPath = manager.getSessionFile()
    expect(sessionPath).toBeTruthy()

    const reader = new PiSessionFileReader()
    const first = await reader.read(sessionPath!)
    const cached = await reader.read(sessionPath!)

    expect(first).toMatchObject({
      name: 'Reader test',
      sessionId: manager.getSessionId(),
      sessionPath,
      workspacePath,
    })
    expect(first.branchEntries.map((entry) => entry.id))
      .toEqual(manager.getBranch().map((entry) => entry.id))
    expect(cached).toBe(first)

    manager.appendMessage({
      content: [{ text: 'Second message', type: 'text' }],
      role: 'user',
      timestamp: 200,
    })
    const updated = await reader.read(sessionPath!)

    expect(updated).not.toBe(first)
    expect(updated.branchEntries.map((entry) => entry.id))
      .toEqual(manager.getBranch().map((entry) => entry.id))
  })
})
