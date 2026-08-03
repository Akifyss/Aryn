import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const switchSourceUrl = new URL(
  '../src/features/agent/components/agent-type-switch/agent-type-switch.tsx',
  import.meta.url,
)

describe('AgentTypeSwitch', () => {
  it('renders unavailable details through the shared description slot', async () => {
    const source = await readFile(switchSourceUrl, 'utf8')

    expect(source).toContain('description={isUnavailable ? (')
    expect(source).toContain('<span id={reasonId}>')
    expect(source).toContain('<span id={guidanceId}>')
    expect(source).toContain('availability.reason')
    expect(source).toContain('availability.guidance')
    expect(source).not.toContain('AgentTypeSwitchOptionCopy')
  })

  it('keeps available options on the shared single-line item path', async () => {
    const source = await readFile(switchSourceUrl, 'utf8')

    expect(source).toContain('text={availability.definition.label}')
    expect(source).toContain('description={isUnavailable ? (')
    expect(source).not.toContain("size='lg'")
    expect(source).not.toContain('agent-type-switch-option-title')
    expect(source).not.toContain('agent-type-switch-option-copy')
  })

  it('refreshes only when opening and keeps unavailable options focusable but inert', async () => {
    const source = await readFile(switchSourceUrl, 'utf8')

    expect(source).toContain('if (open) void onRefresh()')
    expect(source).toContain('<Menu.RadioGroup')
    expect(source).toContain('<Menu.RadioItem')
    expect(source).toContain('eventDetails.cancel()')
    expect(source).toContain('aria-disabled={isUnavailable || undefined}')
    expect(source).toContain('closeOnClick={!isUnavailable}')
    expect(source).toContain('if (isUnavailable) {')
    expect(source).toContain('event.preventDefault()')
    expect(source).toContain("className='agent-type-switch-error'")
    expect(source).not.toContain('agent-type-switch-refresh')
    expect(source).not.toContain('Refresh2Line')
    expect(source).not.toContain('isRefreshing')
    expect(source).not.toContain('title={!availability.available')
  })

  it('mounts the menu in the drawer-local overlay while using the shared positioner', async () => {
    const [switchSource, promptSource, chatSurfaceSource, styleSource] = await Promise.all([
      readFile(switchSourceUrl, 'utf8'),
      readFile(
        new URL(
          '../src/features/agent/components/agent-new-conversation-prompt/agent-new-conversation-prompt.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../src/features/agent/components/agent-type-switch/styles.css', import.meta.url),
        'utf8',
      ),
    ])

    expect(switchSource).toContain('<Menu.Portal container={menuPortalTarget ?? undefined}>')
    expect(switchSource).not.toContain('agent-type-switch-menu-positioner')
    expect(switchSource).toContain("triggerIconSize = 'md'")
    expect(promptSource).toContain("triggerIconSize='xl'")
    expect(promptSource).toContain('<AgentTypeSwitchTrigger menuPortalTarget={menuPortalTarget} />')
    expect(chatSurfaceSource).toMatch(
      /<AgentNewConversationPrompt\s+menuPortalTarget=\{\s*surfaceMode === 'drawer' \? localOverlayRoot : undefined\s*\}/,
    )
    expect(styleSource).not.toContain('.agent-type-switch-menu-positioner')
  })
})
