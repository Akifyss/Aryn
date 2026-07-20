import type { CSSProperties } from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import './styles.css'

type AgentBrandIconTone = 'brand' | 'muted'

type AgentBrandIconProps = {
  agentId: AgentId
  className?: string
  size?: number
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

function getIconStyle(size: number, src: string): CSSProperties {
  return {
    '--agent-brand-icon-size': `${size}px`,
    '--agent-brand-icon-url': `url("${src}")`,
  } as CSSProperties
}

export function AgentBrandIcon({ agentId, className, size = 16, tone = 'brand' }: AgentBrandIconProps) {
  const src = getAgentIconSrc(agentId)
  const style = getIconStyle(size, src)

  if (tone === 'muted') {
    return (
      <span
        aria-hidden='true'
        className={['agent-brand-icon-mask', className].filter(Boolean).join(' ')}
        style={style}
      />
    )
  }

  return (
    <img
      alt=''
      aria-hidden='true'
      className={['agent-brand-icon-image', className].filter(Boolean).join(' ')}
      draggable={false}
      src={src}
      style={style}
    />
  )
}
