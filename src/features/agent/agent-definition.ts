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
    description: 'Aryn 内置的 PI Agent，无需另外安装 CLI',
    id: 'builtin-pi',
    label: '内置 Agent（PI）',
    requiresCli: false,
    transport: 'embedded-sdk',
  },
  {
    description: '使用电脑上安装并已配置的 PI CLI',
    id: 'pi',
    label: 'PI CLI',
    requiresCli: true,
    transport: 'jsonl-rpc',
  },
  {
    description: '使用电脑上安装并已配置的 OpenCode CLI',
    id: 'opencode',
    label: 'OpenCode CLI',
    requiresCli: true,
    transport: 'http-server',
  },
  {
    description: '使用电脑上安装并已登录的 Codex CLI',
    id: 'codex',
    label: 'Codex CLI',
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
