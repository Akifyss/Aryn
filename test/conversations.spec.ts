import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getArynPiSessionDir } from '../electron/main/agent'
import { ConversationStore } from '../electron/main/conversations'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempDir() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'conversation-store-'))
  tempRoots.push(rootPath)
  return rootPath
}

function getLocalDateStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

describe('conversation store', () => {
  it('creates a projectless conversation workspace under Documents/Aryn', async () => {
    const rootPath = await createTempDir()
    const documentsPath = path.join(rootPath, 'Documents')
    const indexPath = path.join(rootPath, '.aryn', 'conversations', 'index.json')
    const store = new ConversationStore(indexPath, documentsPath)

    const record = await store.createWorkspace({ initialPrompt: 'Review the storage design' })
    const workspacePath = record.workspacePath

    expect(workspacePath).toBeTruthy()
    expect(workspacePath?.startsWith(path.join(documentsPath, 'Aryn', getLocalDateStamp()))).toBe(true)
    expect(path.basename(workspacePath!)).toBe('Review the storage design')
    expect(record.status).toBe('draft')
    expect(record.titleSource).toBe('prompt')
    expect(record.agentSessionPath).toBeNull()

    const persisted = JSON.parse(await readFile(indexPath, 'utf8'))
    expect(persisted.conversations).toHaveLength(1)
    expect(persisted.conversations[0]).toMatchObject({
      id: record.id,
      status: 'draft',
      titleSource: 'prompt',
      workspacePath,
    })
  })

  it('uses the default title source for blank projectless prompts', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )

    const record = await store.createWorkspace({ initialPrompt: '   \n ' })

    expect(record).toMatchObject({
      title: '新对话',
      titleSource: 'default',
      lastMessagePreview: null,
    })
    expect(path.basename(record.workspacePath!)).toBe('新对话')
  })

  it('keeps conversation metadata in the index instead of rewriting the workspace path', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )
    const record = await store.createWorkspace({ initialPrompt: 'Initial title' })
    const sessionPath = path.join(
      getArynPiSessionDir(record.workspacePath!, path.join(rootPath, '.aryn', 'agents', 'pi')),
      'session.jsonl',
    )

    const updated = await store.updateConversation(record.id, {
      agentSessionPath: sessionPath,
      lastMessagePreview: 'Updated preview',
      status: 'active',
      title: 'Updated title',
      titleSource: 'agent',
    })

    expect(updated).toMatchObject({
      id: record.id,
      agentSessionPath: sessionPath,
      lastMessagePreview: 'Updated preview',
      status: 'active',
      title: 'Updated title',
      titleSource: 'agent',
      workspacePath: record.workspacePath,
    })
    expect(path.basename(updated.workspacePath!)).toBe('Initial title')
  })

  it('treats title-only updates as user-authored renames', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )
    const record = await store.createWorkspace({ initialPrompt: 'Initial prompt' })

    const updated = await store.updateConversation(record.id, {
      title: 'Manual title',
    })

    expect(updated).toMatchObject({
      title: 'Manual title',
      titleSource: 'user',
      workspacePath: record.workspacePath,
    })
  })

  it('refreshes an active conversation preview without rewriting its established title', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )
    const record = await store.createWorkspace({ initialPrompt: 'Stable title' })

    const updated = await store.updateConversation(record.id, {
      lastMessagePreview: 'Later follow-up',
      status: 'active',
    })

    expect(updated).toMatchObject({
      lastMessagePreview: 'Later follow-up',
      status: 'active',
      title: 'Stable title',
      titleSource: 'prompt',
    })
  })

  it('deduplicates automatically created workspace folders', async () => {
    const rootPath = await createTempDir()
    const documentsPath = path.join(rootPath, 'Documents')
    const datePath = path.join(documentsPath, 'Aryn', getLocalDateStamp())
    await mkdir(path.join(datePath, 'Same topic'), { recursive: true })

    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      documentsPath,
    )

    const record = await store.createWorkspace({ initialPrompt: 'Same topic' })

    expect(path.basename(record.workspacePath!)).toBe('Same topic-2')
  })

  it('allocates distinct workspace folders for concurrent drafts with the same title', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )

    const [firstRecord, secondRecord] = await Promise.all([
      store.createWorkspace({ initialPrompt: 'Concurrent topic' }),
      store.createWorkspace({ initialPrompt: 'Concurrent topic' }),
    ])

    expect(new Set([firstRecord.workspacePath, secondRecord.workspacePath]).size).toBe(2)
    expect([
      path.basename(firstRecord.workspacePath!),
      path.basename(secondRecord.workspacePath!),
    ].sort()).toEqual(['Concurrent topic', 'Concurrent topic-2'])
  })

  it('avoids Windows reserved device names for generated folders', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )

    const record = await store.createWorkspace({ initialPrompt: 'CON' })

    expect(path.basename(record.workspacePath!)).toBe('CON-folder')
  })

  it('removes a failed draft workspace when it only contains Pi metadata', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )
    const record = await store.createWorkspace({ initialPrompt: 'Failed draft' })
    await mkdir(path.join(record.workspacePath!, '.pi', 'sessions'), { recursive: true })
    await writeFile(path.join(record.workspacePath!, '.pi', 'sessions', 'draft.jsonl'), '{}\n', 'utf8')

    const state = await store.removeDraft(record.id)

    expect(state.conversations).toEqual([])
    await expect(stat(record.workspacePath!)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('keeps a failed draft workspace when it contains user files', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )
    const record = await store.createWorkspace({ initialPrompt: 'Keep my files' })
    await writeFile(path.join(record.workspacePath!, 'notes.md'), '# Keep\n', 'utf8')

    const state = await store.removeDraft(record.id)

    expect(state.conversations).toEqual([])
    await expect(readFile(path.join(record.workspacePath!, 'notes.md'), 'utf8')).resolves.toBe('# Keep\n')
  })

  it('removes an active conversation from the index without deleting workspace files', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )
    const record = await store.createWorkspace({ initialPrompt: 'Keep artifacts' })
    await store.updateConversation(record.id, {
      status: 'active',
      title: 'Keep artifacts',
    })
    await writeFile(path.join(record.workspacePath!, 'artifact.md'), '# Artifact\n', 'utf8')

    const state = await store.removeConversation(record.id)

    expect(state.conversations).toEqual([])
    await expect(readFile(path.join(record.workspacePath!, 'artifact.md'), 'utf8')).resolves.toBe('# Artifact\n')
  })

  it('reports a missing conversation when removing from the index', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )

    await expect(store.removeConversation('missing-conversation')).rejects.toThrow('Conversation not found.')
  })

  it('cleans up stale draft conversations on application startup', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )
    const draftRecord = await store.createWorkspace({ initialPrompt: 'Interrupted draft' })
    const activeRecord = await store.createWorkspace({ initialPrompt: 'Completed conversation' })
    await mkdir(path.join(draftRecord.workspacePath!, '.pi'), { recursive: true })
    await store.updateConversation(activeRecord.id, {
      status: 'active',
      title: 'Completed conversation',
    })

    const cleanupResult = await store.cleanupDrafts()

    expect(cleanupResult.removedDrafts.map((conversation) => conversation.id)).toEqual([draftRecord.id])
    expect(cleanupResult.state.conversations.map((conversation) => conversation.id)).toEqual([activeRecord.id])
    await expect(stat(draftRecord.workspacePath!)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await stat(activeRecord.workspacePath!)).isDirectory()).toBe(true)
  })

  it('normalizes invalid persisted timestamps before sorting', async () => {
    const rootPath = await createTempDir()
    const indexPath = path.join(rootPath, '.aryn', 'conversations', 'index.json')
    await mkdir(path.dirname(indexPath), { recursive: true })
    await writeFile(indexPath, JSON.stringify({
      conversations: [
        {
          id: 'broken-date',
          createdAt: 'not-a-date',
          updatedAt: 'also-not-a-date',
        },
      ],
    }), 'utf8')
    const store = new ConversationStore(indexPath, path.join(rootPath, 'Documents'))

    const state = await store.read()

    expect(state.conversations[0]).toMatchObject({
      createdAt: '1970-01-01T00:00:00.000Z',
      titleSource: 'default',
      updatedAt: '1970-01-01T00:00:00.000Z',
    })
  })

  it('migrates legacy conversations to the embedded PI Agent without changing their session link', async () => {
    const rootPath = await createTempDir()
    const indexPath = path.join(rootPath, '.aryn', 'conversations', 'index.json')
    const legacySessionPath = path.join(rootPath, 'legacy-session.jsonl')
    await mkdir(path.dirname(indexPath), { recursive: true })
    await writeFile(indexPath, JSON.stringify({
      version: 2,
      conversations: [{
        id: 'legacy-conversation',
        title: 'Legacy conversation',
        createdAt: '2026-05-30T10:00:00.000Z',
        updatedAt: '2026-05-30T10:01:00.000Z',
        status: 'active',
        workspacePath: rootPath,
        agentSessionPath: legacySessionPath,
      }],
    }), 'utf8')
    const store = new ConversationStore(indexPath, path.join(rootPath, 'Documents'))

    const state = await store.read()

    expect(state.version).toBe(3)
    expect(state.conversations[0]).toMatchObject({
      agentId: 'builtin-pi',
      agentSessionPath: legacySessionPath,
      id: 'legacy-conversation',
    })
  })

  it('keeps the Agent immutable after a conversation is created', async () => {
    const rootPath = await createTempDir()
    const store = new ConversationStore(
      path.join(rootPath, '.aryn', 'conversations', 'index.json'),
      path.join(rootPath, 'Documents'),
    )
    const record = await store.createWorkspace({ agentId: 'pi', initialPrompt: 'Keep the adapter stable' })

    const updated = await store.updateConversation(record.id, { agentId: 'codex' } as never)

    expect(updated.agentId).toBe('pi')
  })

  it('infers title source for legacy persisted conversations conservatively', async () => {
    const rootPath = await createTempDir()
    const indexPath = path.join(rootPath, '.aryn', 'conversations', 'index.json')
    await mkdir(path.dirname(indexPath), { recursive: true })
    await writeFile(indexPath, JSON.stringify({
      conversations: [
        {
          id: 'default-title',
          title: '新对话',
          createdAt: '2026-05-30T10:00:00.000Z',
          updatedAt: '2026-05-30T10:00:00.000Z',
          status: 'active',
        },
        {
          id: 'prompt-title',
          title: 'Original prompt',
          lastMessagePreview: 'Original prompt',
          createdAt: '2026-05-30T10:01:00.000Z',
          updatedAt: '2026-05-30T10:01:00.000Z',
          status: 'active',
        },
        {
          id: 'custom-title',
          title: 'Custom title',
          lastMessagePreview: 'Original prompt',
          createdAt: '2026-05-30T10:02:00.000Z',
          updatedAt: '2026-05-30T10:02:00.000Z',
          status: 'active',
        },
      ],
    }), 'utf8')
    const store = new ConversationStore(indexPath, path.join(rootPath, 'Documents'))

    const state = await store.read()

    expect(state.conversations.find((conversation) => conversation.id === 'default-title')).toMatchObject({
      titleSource: 'default',
    })
    expect(state.conversations.find((conversation) => conversation.id === 'prompt-title')).toMatchObject({
      titleSource: 'prompt',
    })
    expect(state.conversations.find((conversation) => conversation.id === 'custom-title')).toMatchObject({
      titleSource: 'user',
    })
  })

  it('deduplicates persisted conversations by stable id', async () => {
    const rootPath = await createTempDir()
    const indexPath = path.join(rootPath, '.aryn', 'conversations', 'index.json')
    await mkdir(path.dirname(indexPath), { recursive: true })
    await writeFile(indexPath, JSON.stringify({
      conversations: [
        {
          id: 'conversation-1',
          title: 'Old title',
          createdAt: '2026-05-30T10:00:00.000Z',
          updatedAt: '2026-05-30T10:00:00.000Z',
          status: 'draft',
        },
        {
          id: 'conversation-1',
          title: 'Current title',
          createdAt: '2026-05-30T10:00:00.000Z',
          updatedAt: '2026-05-30T10:02:00.000Z',
          status: 'active',
        },
      ],
    }), 'utf8')
    const store = new ConversationStore(indexPath, path.join(rootPath, 'Documents'))

    const state = await store.read()

    expect(state.conversations).toHaveLength(1)
    expect(state.conversations[0]).toMatchObject({
      id: 'conversation-1',
      status: 'active',
      title: 'Current title',
      updatedAt: '2026-05-30T10:02:00.000Z',
    })
  })

  it('restores the conversation index from backup when the primary index is malformed', async () => {
    const rootPath = await createTempDir()
    const indexPath = path.join(rootPath, '.aryn', 'conversations', 'index.json')
    await mkdir(path.dirname(indexPath), { recursive: true })
    await writeFile(indexPath, '{', 'utf8')
    await writeFile(`${indexPath}.bak`, JSON.stringify({
      conversations: [
        {
          id: 'conversation-from-backup',
          title: 'Recovered conversation',
          createdAt: '2026-05-30T10:00:00.000Z',
          updatedAt: '2026-05-30T10:01:00.000Z',
          status: 'active',
        },
      ],
    }), 'utf8')
    const store = new ConversationStore(indexPath, path.join(rootPath, 'Documents'))

    const state = await store.read()

    expect(state.conversations).toHaveLength(1)
    expect(state.conversations[0]).toMatchObject({
      id: 'conversation-from-backup',
      title: 'Recovered conversation',
      status: 'active',
    })

    const repairedIndex = JSON.parse(await readFile(indexPath, 'utf8'))
    expect(repairedIndex.conversations[0]).toMatchObject({
      id: 'conversation-from-backup',
      title: 'Recovered conversation',
    })
  })

  it('does not silently clear conversations when the index is malformed without backup', async () => {
    const rootPath = await createTempDir()
    const indexPath = path.join(rootPath, '.aryn', 'conversations', 'index.json')
    await mkdir(path.dirname(indexPath), { recursive: true })
    await writeFile(indexPath, '{', 'utf8')
    const store = new ConversationStore(indexPath, path.join(rootPath, 'Documents'))

    await expect(store.read()).rejects.toThrow(SyntaxError)
  })
})
