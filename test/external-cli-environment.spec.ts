import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createLoginShellPathPreparation,
  createExternalCliEnvironment,
  getExternalCliPath,
  resolveExternalCliCommand,
} from '../electron/main/external-cli-environment'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('external CLI environment', () => {
  it('removes project dependency bins while preserving user CLI locations', () => {
    const projectBin = path.join(process.cwd(), 'node_modules', '.bin')
    const ancestorBin = path.join(path.dirname(process.cwd()), 'node_modules', '.bin')
    const entries = process.platform === 'win32'
      ? [projectBin, ancestorBin, 'C:\\Users\\me\\AppData\\Roaming\\npm', 'C:\\Windows\\System32']
      : [projectBin, ancestorBin, '/home/me/.local/bin', '/usr/bin']

    expect(getExternalCliPath(entries.join(path.delimiter)).split(path.delimiter)).toEqual(entries.slice(2))
  })

  it('removes quoted dependency bins before normalizing PATH entries', () => {
    const projectBin = path.join(process.cwd(), 'node_modules', '.bin')
    const userBin = process.platform === 'win32' ? 'C:\\Users\\me\\bin' : '/home/me/bin'

    expect(getExternalCliPath([`"${projectBin}"`, userBin].join(path.delimiter))).toBe(userBin)
  })

  it('honors a PATH override without retaining a differently-cased inherited key', () => {
    const customPath = process.platform === 'win32' ? 'C:\\custom\\bin' : '/custom/bin'
    const environment = createExternalCliEnvironment({ PATH: customPath })
    const pathEntries = Object.entries(environment).filter(([key]) => key.toLowerCase() === 'path')

    expect(pathEntries).toHaveLength(1)
    expect(pathEntries[0]?.[1]).toBe(customPath)
  })

  it('resolves an explicit platform entry instead of leaving shim selection to the shell', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'aryn-cli-resolution-'))
    const extension = process.platform === 'win32' ? '.cmd' : ''
    const commandPath = path.join(directory, `sample-agent${extension}`)
    try {
      await writeFile(commandPath, process.platform === 'win32' ? '@echo off\r\n' : '#!/bin/sh\n', 'utf8')
      if (process.platform !== 'win32') await chmod(commandPath, 0o755)
      const environment = createExternalCliEnvironment({ PATH: directory })

      expect(resolveExternalCliCommand('sample-agent', environment)).toBe(commandPath)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('queues one forced login PATH refresh behind an ordinary in-flight load', async () => {
    const initial = deferred<string>()
    const forced = deferred<string>()
    const loadPath = vi.fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => forced.promise)
    const preparation = createLoginShellPathPreparation({ loadPath })

    const normalLoad = preparation.prepare()
    const forcedLoadA = preparation.prepare({ force: true })
    const forcedLoadB = preparation.prepare({ force: true })
    await vi.waitFor(() => {
      expect(loadPath).toHaveBeenCalledOnce()
    })

    initial.resolve('/initial/bin')
    await normalLoad
    await vi.waitFor(() => {
      expect(loadPath).toHaveBeenCalledTimes(2)
    })

    forced.resolve('/refreshed/bin')
    await Promise.all([forcedLoadA, forcedLoadB])
    expect(preparation.getValue()).toBe('/refreshed/bin')
    expect(loadPath).toHaveBeenCalledTimes(2)
  })

  it('reloads a cached login PATH when preparation is forced', async () => {
    const loadPath = vi.fn()
      .mockResolvedValueOnce('/initial/bin')
      .mockResolvedValueOnce('/refreshed/bin')
    const preparation = createLoginShellPathPreparation({ loadPath })

    await preparation.prepare()
    await preparation.prepare({ force: true })

    expect(preparation.getValue()).toBe('/refreshed/bin')
    expect(loadPath).toHaveBeenCalledTimes(2)
  })

  it('recovers after a PATH loader throws synchronously', async () => {
    const loadPath = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('shell failed')
      })
      .mockResolvedValueOnce('/recovered/bin')
    const preparation = createLoginShellPathPreparation({ loadPath })

    await expect(preparation.prepare()).rejects.toThrow('shell failed')
    await expect(preparation.prepare()).resolves.toBeUndefined()
    expect(preparation.getValue()).toBe('/recovered/bin')
    expect(loadPath).toHaveBeenCalledTimes(2)
  })
})
