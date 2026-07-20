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
      sessionTreeSource,
      sessionTreeCss,
      brandIconSource,
      brandIconCss,
      messageSource,
      messageCss,
      fileCardSource,
      fileCardCss,
      queuedTraySource,
      queuedTrayCss,
    ] = await Promise.all([
      readSource('../src/App.tsx'),
      readSource('../src/App.css'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-sidebar/styles.css'),
      readSource('../src/features/agent/components/agent-session-tree/agent-session-tree.tsx'),
      readSource('../src/features/agent/components/agent-session-tree/styles.css'),
      readSource('../src/features/agent/components/agent-brand-icon/agent-brand-icon.tsx'),
      readSource('../src/features/agent/components/agent-brand-icon/styles.css'),
      readSource('../src/features/agent/components/agent-message/agent-message.tsx'),
      readSource('../src/features/agent/components/agent-message/styles.css'),
      readSource('../src/features/agent/components/agent-file-card/agent-file-card.tsx'),
      readSource('../src/features/agent/components/agent-file-card/styles.css'),
      readSource('../src/features/agent/components/agent-queued-composer-tray/agent-queued-composer-tray.tsx'),
      readSource('../src/features/agent/components/agent-queued-composer-tray/styles.css'),
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
    expect(sidebarSource).toContain(
      "from '@/features/agent/components/agent-session-tree/agent-session-tree'",
    )
    expect(sidebarSource).toContain(
      "from '@/features/agent/components/agent-queued-composer-tray/agent-queued-composer-tray'",
    )
    expect(sessionTreeSource).toContain("import './styles.css'")
    expect(brandIconSource).toContain("import './styles.css'")
    expect(messageSource).toContain("import './styles.css'")
    expect(messageSource).toContain(
      "from '@/features/agent/components/agent-file-card/agent-file-card'",
    )
    expect(fileCardSource).toContain("import './styles.css'")
    expect(queuedTraySource).toContain("import './styles.css'")
    expect(sidebarCss).toContain('.agent-shell {')
    expect(sidebarCss).toContain('.agent-message-stack {')
    expect(sidebarCss).toContain('.agent-composer {')
    expect(sidebarCss).toContain('.opencode-session-surface-host {')
    expect(sidebarCss).toContain('.codex-session-surface-host {')
    expect(sessionTreeCss).toContain('.agent-session-tree-shell {')
    expect(sessionTreeCss).toContain('.agent-project-menu {')
    expect(sessionTreeCss).toContain('.agent-project-switch-trigger {')
    expect(brandIconCss).toContain('.agent-brand-icon {')
    expect(brandIconCss).toContain('.agent-brand-icon-mask {')
    expect(messageCss).toContain('.agent-message {')
    expect(messageCss).toContain('.agent-markdown {')
    expect(fileCardCss).toContain('.agent-file-card {')
    expect(queuedTrayCss).toContain('.agent-queued-tray {')
    expect(queuedTrayCss).toContain('.agent-queued-menu {')
    expect(sidebarCss).not.toContain('.agent-message {')
    expect(sidebarCss).not.toContain('.agent-file-card {')
    expect(sidebarCss).not.toContain('.agent-session-tree-shell {')
    expect(sidebarCss).not.toContain('.agent-project-menu {')
    expect(sidebarCss).not.toContain('.agent-brand-icon {')
    expect(sidebarCss).not.toContain('.agent-queued-')
    expect(messageCss).not.toContain('.agent-file-card {')

    const sidebarClassNames = new Set(
      Array.from(sidebarCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )
    const messageClassNames = new Set(
      Array.from(messageCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )
    const sessionTreeClassNames = new Set(
      Array.from(sessionTreeCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )
    const brandIconClassNames = new Set(
      Array.from(brandIconCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )
    const fileCardClassNames = new Set(
      Array.from(fileCardCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )
    const queuedTrayClassNames = new Set(
      Array.from(queuedTrayCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )

    const agentClassNames = new Set([
      ...sidebarClassNames,
      ...sessionTreeClassNames,
      ...brandIconClassNames,
      ...messageClassNames,
      ...fileCardClassNames,
      ...queuedTrayClassNames,
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
    const [
      sidebarSource,
      sessionTreeSource,
      messageSource,
      fileCardSource,
      queuedTraySource,
    ] = await Promise.all([
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-session-tree/agent-session-tree.tsx'),
      readSource('../src/features/agent/components/agent-message/agent-message.tsx'),
      readSource('../src/features/agent/components/agent-file-card/agent-file-card.tsx'),
      readSource('../src/features/agent/components/agent-queued-composer-tray/agent-queued-composer-tray.tsx'),
    ])

    expect(sidebarSource).not.toContain('function AgentMarkdown(')
    expect(sidebarSource).not.toContain('function AgentMessageDisclosure(')
    expect(sidebarSource).not.toContain('function AgentFileCard(')
    expect(sidebarSource).not.toContain('const AgentMessageBubble =')
    expect(sidebarSource).not.toContain('const AgentMessageFileCards =')
    expect(sidebarSource).not.toContain('function AgentSessionTreeRow(')
    expect(sidebarSource).not.toContain('function AgentProjectTree(')
    expect(sidebarSource).not.toContain('function AgentProjectSwitchTrigger(')
    expect(sidebarSource).not.toContain('function AgentQueuedComposerTray(')

    expect(sessionTreeSource).toContain('export function AgentSessionTreeView(')
    expect(sessionTreeSource).toContain('export function AgentProjectSwitchTrigger(')
    expect(sessionTreeSource).not.toContain('agent-inline-spinner')
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
    expect(queuedTraySource).toContain('export function AgentQueuedComposerTray(')
  })

  it('keeps the extracted stylesheet scoped to Agent UI', async () => {
    const [
      sidebarCss,
      sessionTreeCss,
      brandIconCss,
      messageCss,
      fileCardCss,
      queuedTrayCss,
    ] = await Promise.all([
      readSource('../src/features/agent/components/agent-sidebar/styles.css'),
      readSource('../src/features/agent/components/agent-session-tree/styles.css'),
      readSource('../src/features/agent/components/agent-brand-icon/styles.css'),
      readSource('../src/features/agent/components/agent-message/styles.css'),
      readSource('../src/features/agent/components/agent-file-card/styles.css'),
      readSource('../src/features/agent/components/agent-queued-composer-tray/styles.css'),
    ])

    for (const agentCss of [
      sidebarCss,
      sessionTreeCss,
      brandIconCss,
      messageCss,
      fileCardCss,
      queuedTrayCss,
    ]) {
      expect(agentCss).not.toContain('.tree-header.file-panel-header')
      expect(agentCss).not.toContain('[data-command-active=')
      expect(agentCss).not.toContain('[data-slot="backdrop"]')
      expect(agentCss).not.toContain('.window-button')
      expect(agentCss).not.toContain('.command-palette-')
      expect(agentCss).not.toContain('.meo-editor-shell')
    }
  })
})
