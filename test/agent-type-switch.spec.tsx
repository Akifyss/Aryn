import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AgentTypeSwitchOptionCopy } from '@/features/agent/components/agent-type-switch/agent-type-switch'
import { getAgentDefinition, type AgentAvailability } from '@/features/agent/agent-definition'

function availability(overrides: Partial<AgentAvailability> = {}): AgentAvailability {
  return {
    available: false,
    command: 'codex',
    definition: getAgentDefinition('codex'),
    guidance: '完成登录后重新检测。',
    reason: 'Codex 尚未登录',
    version: 'codex-cli 0.144.5',
    ...overrides,
  }
}

describe('AgentTypeSwitch', () => {
  it('renders the unavailable reason and recovery guidance as visible content', () => {
    const markup = renderToStaticMarkup(
      <AgentTypeSwitchOptionCopy
        availability={availability()}
        guidanceId='codex-guidance'
        reasonId='codex-reason'
      />,
    )

    expect(markup).toContain('Codex 尚未登录')
    expect(markup).toContain('完成登录后重新检测。')
    expect(markup).toContain('id="codex-reason"')
    expect(markup).toContain('id="codex-guidance"')
    expect(markup).not.toContain('title=')
  })

  it('keeps available options compact', () => {
    const markup = renderToStaticMarkup(
      <AgentTypeSwitchOptionCopy
        availability={availability({
          available: true,
          guidance: null,
          reason: null,
        })}
      />,
    )

    expect(markup).toContain('Codex')
    expect(markup).not.toContain('agent-type-switch-option-description')
    expect(markup).not.toContain('agent-type-switch-option-guidance')
  })

  it('refreshes only when opening and keeps unavailable options focusable but inert', async () => {
    const source = await readFile(
      new URL('../src/features/agent/components/agent-type-switch/agent-type-switch.tsx', import.meta.url),
      'utf8',
    )

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
})
