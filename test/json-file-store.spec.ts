import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AtomicJsonStore } from '../electron/main/json-file-store'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempDir() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'json-file-store-'))
  tempRoots.push(rootPath)
  return rootPath
}

type TestState = {
  count: number
  version: number
}

function normalizeTestState(value: unknown): TestState {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  return {
    count: typeof candidate.count === 'number' && Number.isFinite(candidate.count)
      ? candidate.count
      : 0,
    version: 3,
  }
}

describe('AtomicJsonStore', () => {
  it('normalizes missing state and serializes queued updates', async () => {
    const rootPath = await createTempDir()
    const filePath = path.join(rootPath, '.aryn', 'state.json')
    const store = new AtomicJsonStore<TestState>({
      defaultState: () => ({ count: 1, version: 0 }),
      filePath,
      normalize: normalizeTestState,
    })

    expect(await store.read()).toEqual({ count: 1, version: 3 })

    await Promise.all([
      store.update((state) => ({ ...state, count: state.count + 1 })),
      store.update((state) => ({ ...state, count: state.count + 1 })),
    ])

    expect(await store.read()).toEqual({ count: 3, version: 3 })
    await expect(readFile(filePath, 'utf8').then(JSON.parse)).resolves.toEqual({ count: 3, version: 3 })
  })

  it('restores from backup and repairs the primary file', async () => {
    const rootPath = await createTempDir()
    const filePath = path.join(rootPath, '.aryn', 'state.json')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, '{', 'utf8')
    await writeFile(`${filePath}.bak`, JSON.stringify({ count: 7, version: 1 }), 'utf8')
    const store = new AtomicJsonStore<TestState>({
      defaultState: () => ({ count: 0, version: 0 }),
      filePath,
      normalize: normalizeTestState,
    })

    expect(await store.read()).toEqual({ count: 7, version: 3 })
    await expect(readFile(filePath, 'utf8').then(JSON.parse)).resolves.toEqual({ count: 7, version: 3 })
  })

  it('does not silently replace malformed state when no backup is available', async () => {
    const rootPath = await createTempDir()
    const filePath = path.join(rootPath, '.aryn', 'state.json')
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, '{', 'utf8')
    const store = new AtomicJsonStore<TestState>({
      defaultState: () => ({ count: 0, version: 0 }),
      filePath,
      normalize: normalizeTestState,
    })

    await expect(store.read()).rejects.toThrow(SyntaxError)
  })
})
