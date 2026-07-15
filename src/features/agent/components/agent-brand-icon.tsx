import { Codex, OpenCode } from '@lobehub/icons'
import type { AgentId } from '@/features/agent/agent-definition'

type AgentBrandIconProps = {
  agentId: AgentId
  className?: string
  size?: number
}

function PiCodingAgentIcon({ className, size = 16 }: Omit<AgentBrandIconProps, 'agentId'>) {
  return (
    <svg
      aria-hidden='true'
      className={className}
      fill='currentColor'
      focusable='false'
      height={size}
      viewBox='140 140 520 520'
      width={size}
    >
      <path
        fillRule='evenodd'
        d='M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z'
      />
      <path d='M517.36 400H634.72V634.72H517.36Z' />
    </svg>
  )
}

export function AgentBrandIcon({ agentId, className, size = 16 }: AgentBrandIconProps) {
  if (agentId === 'codex') {
    return <Codex aria-hidden='true' className={className} size={size} />
  }

  if (agentId === 'opencode') {
    return <OpenCode aria-hidden='true' className={className} size={size} />
  }

  return <PiCodingAgentIcon className={className} size={size} />
}
