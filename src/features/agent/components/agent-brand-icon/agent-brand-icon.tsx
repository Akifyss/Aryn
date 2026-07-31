import type { CSSProperties } from 'react'
import type { AppIconSize } from '@/components/icon-size'
import type { AgentId } from '@/features/agent/agent-definition'
import './styles.css'

type AgentBrandIconTone = 'brand' | 'muted'

type AgentBrandIconProps = {
  agentId: AgentId
  className?: string
  size?: AppIconSize
  tone?: AgentBrandIconTone
}

const AGENT_ICON_FILES: Record<AgentId, string> = {
  'builtin-pi': 'aryn.svg',
  codex: 'codex.svg',
  opencode: 'opencode.svg',
  pi: 'pi.svg',
}

function getAgentIconSrc(agentId: AgentId) {
  return `./agent-icons/${AGENT_ICON_FILES[agentId]}`
}

function getMaskStyle(src: string): CSSProperties {
  return {
    '--agent-brand-icon-url': `url("${src}")`,
  } as CSSProperties
}

export function AgentBrandIcon({ agentId, className, size = 'md', tone = 'brand' }: AgentBrandIconProps) {
  const src = getAgentIconSrc(agentId)

  if (tone === 'muted') {
    return (
      <span
        aria-hidden='true'
        className={['agent-brand-icon-mask', className].filter(Boolean).join(' ')}
        data-size={size}
        style={getMaskStyle(src)}
      />
    )
  }

  return (
    <img
      alt=''
      aria-hidden='true'
      className={['agent-brand-icon-image', className].filter(Boolean).join(' ')}
      data-size={size}
      draggable={false}
      src={src}
    />
  )
}
