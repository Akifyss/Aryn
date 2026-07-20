import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('agent sidebar structure', () => {
  it('keeps Agent UI styles with their owning Agent components', async () => {
    const [
      appSource,
      appCss,
      sidebarSource,
      sidebarCss,
      messageSource,
      messageCss,
      fileCardSource,
      fileCardCss,
    ] = await Promise.all([
      readSource('../src/App.tsx'),
      readSource('../src/App.css'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-sidebar/styles.css'),
      readSource('../src/features/agent/components/agent-message/agent-message.tsx'),
      readSource('../src/features/agent/components/agent-message/styles.css'),
      readSource('../src/features/agent/components/agent-file-card/agent-file-card.tsx'),
      readSource('../src/features/agent/components/agent-file-card/styles.css'),
    ])

    expect(appSource).toContain(
      "from '@/features/agent/components/agent-sidebar/agent-sidebar'",
    )
    expect(sidebarSource).toContain("import './styles.css'")
    expect(sidebarSource).toContain(
      "from '@/features/agent/components/agent-message/agent-message'",
    )
    expect(sidebarSource).toContain(
      "from '@/features/agent/components/agent-file-card/agent-file-card'",
    )
    expect(messageSource).toContain("import './styles.css'")
    expect(messageSource).toContain(
      "from '@/features/agent/components/agent-file-card/agent-file-card'",
    )
    expect(fileCardSource).toContain("import './styles.css'")
    expect(sidebarCss).toContain('.agent-shell {')
    expect(sidebarCss).toContain('.agent-message-stack {')
    expect(sidebarCss).toContain('.agent-composer {')
    expect(sidebarCss).toContain('.opencode-session-surface-host {')
    expect(sidebarCss).toContain('.codex-session-surface-host {')
    expect(messageCss).toContain('.agent-message {')
    expect(messageCss).toContain('.agent-markdown {')
    expect(fileCardCss).toContain('.agent-file-card {')
    expect(sidebarCss).not.toContain('.agent-message {')
    expect(sidebarCss).not.toContain('.agent-file-card {')
    expect(messageCss).not.toContain('.agent-file-card {')

    const sidebarClassNames = new Set(
      Array.from(sidebarCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )
    const messageClassNames = new Set(
      Array.from(messageCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )
    const fileCardClassNames = new Set(
      Array.from(fileCardCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )

    const agentClassNames = new Set([
      ...sidebarClassNames,
      ...messageClassNames,
      ...fileCardClassNames,
    ])
    expect(agentClassNames.size).toBeGreaterThan(0)
    agentClassNames.forEach((className) => {
      expect(appCss).not.toContain(`.${className}`)
    })

    expect(appCss).not.toContain('.opencode-session-surface-host')
    expect(appCss).not.toContain('.pi-web-session-surface-host')
    expect(appCss).not.toContain('.codex-session-surface-host')
  })

  it('keeps presentation implementations in their owning components', async () => {
    const [sidebarSource, messageSource, fileCardSource] = await Promise.all([
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-message/agent-message.tsx'),
      readSource('../src/features/agent/components/agent-file-card/agent-file-card.tsx'),
    ])

    expect(sidebarSource).not.toContain('function AgentMarkdown(')
    expect(sidebarSource).not.toContain('function AgentMessageDisclosure(')
    expect(sidebarSource).not.toContain('function AgentFileCard(')
    expect(sidebarSource).not.toContain('const AgentMessageBubble =')
    expect(sidebarSource).not.toContain('const AgentMessageFileCards =')

    expect(messageSource).not.toContain('function AgentFileCard(')
    expect(messageSource).not.toContain(
      'function getAgentAttachmentFileCardProps(',
    )
    expect(messageSource).toContain('export const AgentMessageBubble =')
    expect(messageSource).toContain('export const AgentMessageFileCards =')
    expect(fileCardSource).toContain('export function AgentFileCard(')
    expect(fileCardSource).toContain(
      'export function AgentAttachmentFileCard(',
    )
  })

  it('keeps the extracted stylesheet scoped to Agent UI', async () => {
    const [sidebarCss, messageCss, fileCardCss] = await Promise.all([
      readSource('../src/features/agent/components/agent-sidebar/styles.css'),
      readSource('../src/features/agent/components/agent-message/styles.css'),
      readSource('../src/features/agent/components/agent-file-card/styles.css'),
    ])

    for (const agentCss of [sidebarCss, messageCss, fileCardCss]) {
      expect(agentCss).not.toContain('.tree-header.file-panel-header')
      expect(agentCss).not.toContain('[data-command-active=')
      expect(agentCss).not.toContain('[data-slot="backdrop"]')
      expect(agentCss).not.toContain('.window-button')
      expect(agentCss).not.toContain('.command-palette-')
      expect(agentCss).not.toContain('.meo-editor-shell')
    }
  })
})
