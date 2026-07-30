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

  it('does not make Main or Preload depend on Renderer Agent features', async () => {
    const files = [
      ...await listTypeScriptFiles(path.join(root, 'electron/main')),
      ...await listTypeScriptFiles(path.join(root, 'electron/preload')),
    ]
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (source.includes('src/features/agent') || source.includes('@/features/agent')) {
        violations.push(path.relative(root, file))
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
        const imports = source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)
        for (const match of imports) {
          if (!match[1]?.startsWith('.')) continue
          const resolved = path.resolve(path.dirname(file), match[1])
          for (const siblingName of providerNames) {
            if (
              siblingName !== providerName
              && (
                resolved === path.join(providersRoot, siblingName)
                || resolved.startsWith(`${path.join(providersRoot, siblingName)}${path.sep}`)
              )
            ) {
              violations.push(
                `${path.relative(root, file)} -> ${path.relative(root, resolved)}`,
              )
            }
          }
        }
      }
    }

    expect(violations).toEqual([])
  })

  it('keeps shared Agent contracts framework and process agnostic', async () => {
    const files = await listTypeScriptFiles(path.join(root, 'electron/shared/agent-contracts'))
    const violations: string[] = []

    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (
        /\bfrom\s+['"](?:electron|react|react-dom)['"]/.test(source)
        || /\bfrom\s+['"](?:@opencode-ai|@earendil-works)\//.test(source)
        || source.includes('/main/')
        || source.includes('/src/features/')
      ) {
        violations.push(path.relative(root, file))
      }
    }

    expect(violations).toEqual([])
  })
})
