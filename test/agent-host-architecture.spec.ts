import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('..', import.meta.url))

async function listTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listTypeScriptFiles(absolutePath)
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [absolutePath] : []
  }))
  return files.flat()
}

function listModuleSpecifiers(source: string) {
  const specifiers = new Set<string>()
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specifiers.add(match[1])
    }
  }
  return [...specifiers]
}

function resolveLocalModule(importer: string, specifier: string) {
  if (specifier.startsWith('@/')) return path.join(root, 'src', specifier.slice(2))
  if (specifier.startsWith('.')) return path.resolve(path.dirname(importer), specifier)
  return null
}

function isInside(directory: string, candidate: string) {
  const relative = path.relative(directory, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('Agent Host architecture boundaries', () => {
  it('keeps Agent IPC and provider composition out of the Electron entrypoint', async () => {
    const source = await readFile(path.join(root, 'electron/main/index.ts'), 'utf8')

    expect(source).toContain("from './composition/create-agent-host'")
    expect(source).toContain("from './agent-ipc/register-agent-ipc'")
    expect(source).not.toContain("ipcMain.handle('agent:")
    expect(source).not.toContain('new CodexAgentManager')
    expect(source).not.toContain('new OpenCodeAgentManager')
    expect(source).not.toContain('new PiCliAgentManager')
  })

  it('does not make Main or Preload depend on Renderer source', async () => {
    const files = [
      ...await listTypeScriptFiles(path.join(root, 'electron/main')),
      ...await listTypeScriptFiles(path.join(root, 'electron/preload')),
    ]
    const rendererRoot = path.join(root, 'src')
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const specifier of listModuleSpecifiers(source)) {
        const resolved = resolveLocalModule(file, specifier)
        if (resolved && isInside(rendererRoot, resolved)) {
          violations.push(`${path.relative(root, file)} -> ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('does not make Renderer source depend on Main internals', async () => {
    const files = await listTypeScriptFiles(path.join(root, 'src'))
    const mainRoot = path.join(root, 'electron/main')
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const specifier of listModuleSpecifiers(source)) {
        const resolved = resolveLocalModule(file, specifier)
        if (resolved && isInside(mainRoot, resolved)) {
          violations.push(`${path.relative(root, file)} -> ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps provider implementations isolated from sibling providers', async () => {
    const providersRoot = path.join(root, 'electron/main/agent-host/providers')
    const providerNames = ['builtin-pi', 'pi-cli', 'opencode', 'codex'] as const
    const violations: string[] = []

    for (const providerName of providerNames) {
      const providerRoot = path.join(providersRoot, providerName)
      for (const file of await listTypeScriptFiles(providerRoot)) {
        const source = await readFile(file, 'utf8')
        for (const specifier of listModuleSpecifiers(source)) {
          const resolved = resolveLocalModule(file, specifier)
          if (!resolved) continue
          for (const siblingName of providerNames) {
            if (
              siblingName !== providerName
              && (
                resolved === path.join(providersRoot, siblingName)
                || resolved.startsWith(`${path.join(providersRoot, siblingName)}${path.sep}`)
              )
            ) {
              violations.push(
                `${path.relative(root, file)} -> ${specifier}`,
              )
            }
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps Host application and runtime policy independent from provider implementations', async () => {
    const coreRoots = [
      path.join(root, 'electron/main/agent-host/application'),
      path.join(root, 'electron/main/agent-host/runtime'),
    ]
    const providersRoot = path.join(root, 'electron/main/agent-host/providers')
    const violations: string[] = []

    for (const coreRoot of coreRoots) {
      for (const file of await listTypeScriptFiles(coreRoot)) {
        const source = await readFile(file, 'utf8')
        for (const specifier of listModuleSpecifiers(source)) {
          const resolved = resolveLocalModule(file, specifier)
          const importsProvider = Boolean(resolved && isInside(providersRoot, resolved))
          const importsProviderSdk = (
            specifier.startsWith('@opencode-ai/')
            || specifier.startsWith('@earendil-works/')
          )
          if (importsProvider || importsProviderSdk) {
            violations.push(`${path.relative(root, file)} -> ${specifier}`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps shared contracts framework and process agnostic', async () => {
    const files = await listTypeScriptFiles(path.join(root, 'electron/shared'))
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      for (const specifier of listModuleSpecifiers(source)) {
        const forbiddenExternal = (
          specifier === 'electron'
          || specifier === 'react'
          || specifier === 'react-dom'
          || specifier.startsWith('node:')
          || specifier.startsWith('@opencode-ai/')
          || specifier.startsWith('@earendil-works/')
        )
        const resolved = resolveLocalModule(file, specifier)
        const forbiddenLocal = Boolean(
          resolved
          && (
            isInside(path.join(root, 'electron/main'), resolved)
            || isInside(path.join(root, 'src'), resolved)
          )
        )
        if (forbiddenExternal || forbiddenLocal) {
          violations.push(`${path.relative(root, file)} -> ${specifier}`)
        }
      }
      if (/\bprocess\./.test(stripComments(source))) {
        violations.push(`${path.relative(root, file)} -> process`)
      }
    }

    expect(violations).toEqual([])
  })
})
