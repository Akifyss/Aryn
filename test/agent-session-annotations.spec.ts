import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentSessionAnnotationStore, upsertAgentSessionFileChange } from '../electron/main/agent-session-annotations'
import { mergeAgentMessageFileChangeKind } from '../src/features/agent/file-change-utils'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempDir() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'agent-session-annotations-'))
  tempRoots.push(rootPath)
  return rootPath
}

describe('agent session annotations', () => {
  it('keeps a created file as created through later updates', () => {
    const annotations = upsertAgentSessionFileChange(
      {
        fileChangesByEntryId: {},
      },
      'entry-1',
      {
        filePath: 'C:/workspace/story.md',
        kind: 'created',
      },
    )

    const nextAnnotations = upsertAgentSessionFileChange(annotations, 'entry-1', {
      filePath: 'C:/workspace/story.md',
      kind: 'updated',
    })

    expect(nextAnnotations).toEqual({
      fileChangesByEntryId: {
        'entry-1': [
          {
            filePath: 'C:/workspace/story.md',
            kind: 'created',
          },
        ],
      },
    })
  })

  it('drops a file tag when a created file is deleted in the same message', () => {
    const annotations = upsertAgentSessionFileChange(
      {
        fileChangesByEntryId: {},
      },
      'entry-2',
      {
        filePath: 'C:/workspace/temp.md',
        kind: 'created',
      },
    )

    expect(upsertAgentSessionFileChange(annotations, 'entry-2', {
      filePath: 'C:/workspace/temp.md',
      kind: 'deleted',
    })).toEqual({
      fileChangesByEntryId: {},
    })
  })

  it('treats delete followed by add as an update', () => {
    expect(mergeAgentMessageFileChangeKind('deleted', 'created')).toBe('updated')
  })

  it('persists annotations through the shared JSON store', async () => {
    const rootPath = await createTempDir()
    const sessionPath = path.join(rootPath, 'sessions', 'session.jsonl')
    await mkdir(path.dirname(sessionPath), { recursive: true })
    const store = new AgentSessionAnnotationStore()

    await store.recordFileChange(sessionPath, 'entry-1', {
      filePath: path.join(rootPath, 'workspace', 'story.md'),
      kind: 'created',
    })

    await expect(readFile(`${sessionPath}.annotations.json`, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      fileChangesByEntryId: {
        'entry-1': [
          {
            kind: 'created',
          },
        ],
      },
      version: 1,
    })
  })

  it('restores annotations from backup and repairs the primary file', async () => {
    const rootPath = await createTempDir()
    const sessionPath = path.join(rootPath, 'sessions', 'session.jsonl')
    const annotationsPath = `${sessionPath}.annotations.json`
    await mkdir(path.dirname(sessionPath), { recursive: true })
    await writeFile(annotationsPath, '{', 'utf8')
    await writeFile(`${annotationsPath}.bak`, JSON.stringify({
      fileChangesByEntryId: {
        'entry-1': [
          {
            filePath: path.join(rootPath, 'workspace', 'restored.md'),
            kind: 'updated',
          },
        ],
      },
      version: 1,
    }), 'utf8')

    const store = new AgentSessionAnnotationStore()
    await expect(store.read(sessionPath)).resolves.toMatchObject({
      fileChangesByEntryId: {
        'entry-1': [
          {
            kind: 'updated',
          },
        ],
      },
    })
    await expect(readFile(annotationsPath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      fileChangesByEntryId: {
        'entry-1': [
          {
            kind: 'updated',
          },
        ],
      },
      version: 1,
    })
  })

  it('does not silently clear malformed annotations when no backup exists', async () => {
    const rootPath = await createTempDir()
    const sessionPath = path.join(rootPath, 'sessions', 'session.jsonl')
    const annotationsPath = `${sessionPath}.annotations.json`
    await mkdir(path.dirname(sessionPath), { recursive: true })
    await writeFile(annotationsPath, '{', 'utf8')
    const store = new AgentSessionAnnotationStore()

    await expect(store.read(sessionPath)).rejects.toThrow(SyntaxError)
  })
})
