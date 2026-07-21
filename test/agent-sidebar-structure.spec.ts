import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('agent sidebar structure', () => {
  it('keeps Agent session status behavior and styles in its component module', async () => {
    const [appCss, sidebarSource, sidebarCss, statusSource, statusCss] = await Promise.all([
      readSource('../src/App.css'),
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-sidebar/styles.css'),
      readSource('../src/features/agent/components/agent-session-status/agent-session-status.tsx'),
      readSource('../src/features/agent/components/agent-session-status/styles.css'),
    ])

    expect(sidebarSource).toContain(
      "from '@/features/agent/components/agent-session-status/agent-session-status'",
    )
    expect(sidebarSource).not.toContain('function deriveAgentSessionPhase(')
    expect(sidebarSource).not.toContain('function formatAgentSessionStatus(')
    expect(sidebarSource).not.toContain('function AgentSessionStatusBubble(')
    expect(sidebarSource).not.toContain("from 'unicode-animations'")
    expect(statusSource).toContain("import './styles.css'")
    expect(statusSource).toContain('export function deriveAgentSessionPhase(')
    expect(statusSource).toContain('export function formatAgentSessionStatus(')
    expect(statusSource).toContain('export function AgentSessionStatusBubble(')
    expect(statusCss).toContain('.agent-session-status {')
    expect(statusCss).not.toContain('.agent-pi-web-session-status')
    expect(sidebarCss).not.toMatch(/^\.agent-session-status(?:[\s.-]|$)/m)
    expect(sidebarCss).toContain('.agent-pi-web-session-status .agent-session-status {')

    const statusClassNames = new Set(
      Array.from(statusCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )
    expect(statusClassNames.size).toBeGreaterThan(0)
    statusClassNames.forEach((className) => {
      expect(appCss).not.toContain(`.${className}`)
    })
  })

  it('keeps Agent catalog lifecycle state in its feature hook', async () => {
    const [sidebarSource, catalogHookSource] = await Promise.all([
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/hooks/use-agent-catalog.ts'),
    ])

    expect(sidebarSource).toContain(
      "from '@/features/agent/hooks/use-agent-catalog'",
    )
    expect(sidebarSource).toContain(
      'useAgentCatalog({ onCatalogRefreshed: handleAgentCatalogRefreshed })',
    )
    expect(sidebarSource).not.toContain('agentCatalogRequestIdRef')
    expect(sidebarSource).not.toContain('agentCatalogRefreshRef')
    expect(sidebarSource).not.toContain('setAgentAvailabilityFailures')
    expect(sidebarSource).not.toContain('window.appApi.getAgentCatalog(')

    expect(catalogHookSource).toContain('export function useAgentCatalog(')
    expect(catalogHookSource).toContain('window.appApi.getAgentCatalog({ force: true })')
    expect(catalogHookSource).toContain('window.appApi.getAgentCatalog()')
  })

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
      modelCascaderSource,
      modelCascaderCss,
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
      readSource('../src/features/agent/components/agent-model-cascader/agent-model-cascader.tsx'),
      readSource('../src/features/agent/components/agent-model-cascader/styles.css'),
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
    expect(sidebarSource).toContain(
      "from '@/features/agent/components/agent-model-cascader/agent-model-cascader'",
    )
    expect(sessionTreeSource).toContain("import './styles.css'")
    expect(brandIconSource).toContain("import './styles.css'")
    expect(messageSource).toContain("import './styles.css'")
    expect(messageSource).toContain(
      "from '@/features/agent/components/agent-file-card/agent-file-card'",
    )
    expect(fileCardSource).toContain("import './styles.css'")
    expect(queuedTraySource).toContain("import './styles.css'")
    expect(modelCascaderSource).toContain("import './styles.css'")
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
    expect(modelCascaderCss).toContain('.agent-model-cascader {')
    expect(modelCascaderCss).toContain('.agent-model-cascader-trigger {')
    expect(sidebarCss).not.toContain('.agent-message {')
    expect(sidebarCss).not.toContain('.agent-file-card {')
    expect(sidebarCss).not.toContain('.agent-session-tree-shell {')
    expect(sidebarCss).not.toContain('.agent-project-menu {')
    expect(sidebarCss).not.toContain('.agent-brand-icon {')
    expect(sidebarCss).not.toContain('.agent-queued-')
    expect(sidebarCss).not.toContain('.agent-model-cascader')
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
    const modelCascaderClassNames = new Set(
      Array.from(modelCascaderCss.matchAll(/\.(agent-[\w-]+)/g), (match) => match[1]),
    )

    const agentClassNames = new Set([
      ...sidebarClassNames,
      ...sessionTreeClassNames,
      ...brandIconClassNames,
      ...messageClassNames,
      ...fileCardClassNames,
      ...queuedTrayClassNames,
      ...modelCascaderClassNames,
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
      modelCascaderSource,
    ] = await Promise.all([
      readSource('../src/features/agent/components/agent-sidebar/agent-sidebar.tsx'),
      readSource('../src/features/agent/components/agent-session-tree/agent-session-tree.tsx'),
      readSource('../src/features/agent/components/agent-message/agent-message.tsx'),
      readSource('../src/features/agent/components/agent-file-card/agent-file-card.tsx'),
      readSource('../src/features/agent/components/agent-queued-composer-tray/agent-queued-composer-tray.tsx'),
      readSource('../src/features/agent/components/agent-model-cascader/agent-model-cascader.tsx'),
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
    expect(sidebarSource).not.toContain('function AgentModelCascader(')

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
    expect(modelCascaderSource).toContain('export function AgentModelCascader(')
  })

  it('keeps the extracted stylesheet scoped to Agent UI', async () => {
    const [
      sidebarCss,
      sessionTreeCss,
      brandIconCss,
      messageCss,
      fileCardCss,
      queuedTrayCss,
      modelCascaderCss,
      sessionStatusCss,
    ] = await Promise.all([
      readSource('../src/features/agent/components/agent-sidebar/styles.css'),
      readSource('../src/features/agent/components/agent-session-tree/styles.css'),
      readSource('../src/features/agent/components/agent-brand-icon/styles.css'),
      readSource('../src/features/agent/components/agent-message/styles.css'),
      readSource('../src/features/agent/components/agent-file-card/styles.css'),
      readSource('../src/features/agent/components/agent-queued-composer-tray/styles.css'),
      readSource('../src/features/agent/components/agent-model-cascader/styles.css'),
      readSource('../src/features/agent/components/agent-session-status/styles.css'),
    ])

    for (const agentCss of [
      sidebarCss,
      sessionTreeCss,
      brandIconCss,
      messageCss,
      fileCardCss,
      queuedTrayCss,
      modelCascaderCss,
      sessionStatusCss,
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
