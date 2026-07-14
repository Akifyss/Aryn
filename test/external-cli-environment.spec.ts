import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createExternalCliEnvironment,
  getExternalCliPath,
  resolveExternalCliCommand,
} from '../electron/main/external-cli-environment'

describe('external CLI environment', () => {
  it('removes project dependency bins while preserving user CLI locations', () => {
    const projectBin = path.join(process.cwd(), 'node_modules', '.bin')
    const ancestorBin = path.join(path.dirname(process.cwd()), 'node_modules', '.bin')
    const entries = process.platform === 'win32'
      ? [projectBin, ancestorBin, 'C:\\Users\\me\\AppData\\Roaming\\npm', 'C:\\Windows\\System32']
      : [projectBin, ancestorBin, '/home/me/.local/bin', '/usr/bin']

    expect(getExternalCliPath(entries.join(path.delimiter)).split(path.delimiter)).toEqual(entries.slice(2))
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
})
