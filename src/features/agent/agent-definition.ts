export const AGENT_IDS = ['builtin-pi', 'pi', 'opencode', 'codex'] as const

export type AgentId = typeof AGENT_IDS[number]

export type AgentTransport = 'embedded-sdk' | 'jsonl-rpc' | 'app-server' | 'http-server'

export type AgentDefinition = {
  description: string
  id: AgentId
  label: string
  requiresCli: boolean
  transport: AgentTransport
}

export type AgentAvailability = {
  available: boolean
  command: string | null
  definition: AgentDefinition
  reason: string | null
  version: string | null
}

export const DEFAULT_AGENT_ID: AgentId = 'builtin-pi'

export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    description: 'Aryn 内置 Agent，无需额外安装',
    id: 'builtin-pi',
    label: 'Aryn',
    requiresCli: false,
    transport: 'embedded-sdk',
  },
  {
    description: '使用本机已配置的 PI',
    id: 'pi',
    label: 'PI',
    requiresCli: true,
    transport: 'jsonl-rpc',
  },
  {
    description: '使用本机已配置的 OpenCode',
    id: 'opencode',
    label: 'OpenCode',
    requiresCli: true,
    transport: 'http-server',
  },
  {
    description: '使用本机已登录的 Codex',
    id: 'codex',
    label: 'Codex',
    requiresCli: true,
    transport: 'app-server',
  },
] as const

const AGENT_ID_SET = new Set<string>(AGENT_IDS)

export function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && AGENT_ID_SET.has(value)
}

export function normalizeAgentId(value: unknown): AgentId {
  return isAgentId(value) ? value : DEFAULT_AGENT_ID
}

export function getAgentDefinition(agentId: AgentId) {
  return AGENT_DEFINITIONS.find((definition) => definition.id === agentId) ?? AGENT_DEFINITIONS[0]
}
