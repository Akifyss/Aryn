import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('agent sidebar structure', () => {
  it('keeps Agent UI styles with the Agent sidebar feature', async () => {
    const [appSource, appCss, agentSource, agentCss] = await Promise.all([
      readSource('../src/App.tsx'),
      readSource('../src/App.css'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-sidebar/styles.css'),
    ])

    expect(appSource).toContain(
      "from '@/features/agent/components/agent-sidebar/agent-sidebar'",
    )
    expect(agentSource).toContain("import './styles.css'")
    expect(agentCss).toContain('.agent-shell {')
    expect(agentCss).toContain('.agent-message {')
    expect(agentCss).toContain('.agent-composer {')
    expect(agentCss).toContain('.opencode-session-surface-host {')
    expect(agentCss).toContain('.codex-session-surface-host {')

    const agentClassNames = new Set(
      Array.from(
        agentCss.matchAll(/\.(agent-[\w-]+)/g),
        (match) => match[1],
      ),
    )

    expect(agentClassNames.size).toBeGreaterThan(0)
    agentClassNames.forEach((className) => {
      expect(appCss).not.toContain(`.${className}`)
    })

    expect(appCss).not.toContain('.opencode-session-surface-host')
    expect(appCss).not.toContain('.pi-web-session-surface-host')
    expect(appCss).not.toContain('.codex-session-surface-host')
  })

  it('keeps the extracted stylesheet scoped to Agent UI', async () => {
    const agentCss = await readSource(
      '../src/features/agent/components/agent-sidebar/styles.css',
    )

    expect(agentCss).not.toContain('.tree-header.file-panel-header')
    expect(agentCss).not.toContain('[data-command-active=')
    expect(agentCss).not.toContain('[data-slot="backdrop"]')
    expect(agentCss).not.toContain('.window-button')
    expect(agentCss).not.toContain('.command-palette-')
    expect(agentCss).not.toContain('.meo-editor-shell')
  })
})
