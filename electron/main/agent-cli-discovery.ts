import spawn from 'cross-spawn'
import { terminateChildProcessTree } from './child-process-lifecycle'
import {
  createExternalCliEnvironment,
  prepareExternalCliEnvironment,
  resolveExternalCliCommand,
} from './external-cli-environment'
import {
  AGENT_DEFINITIONS,
  type AgentAvailability,
  type AgentDefinition,
} from '../../src/features/agent/agent-definition'
import {
  formatOpenCodeVersionCompatibilityError,
  isCompatibleOpenCodeVersion,
} from '../../src/features/agent/lib/opencode-version'

const DISCOVERY_CACHE_DURATION_MS = 15_000
const PROBE_TIMEOUT_MS = 5_000

type CliProbeDefinition = {
  command: string
  versionArgs: string[]
}

const CLI_PROBES: Partial<Record<AgentDefinition['id'], CliProbeDefinition>> = {
  codex: { command: 'codex', versionArgs: ['--version'] },
  opencode: { command: 'opencode', versionArgs: ['--version'] },
  pi: { command: 'pi', versionArgs: ['--version'] },
}

let cachedCatalog: { expiresAt: number, value: AgentAvailability[] } | null = null
let catalogDiscovery: Promise<AgentAvailability[]> | null = null

function normalizeVersionOutput(stdout: string, stderr: string) {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null
}

function formatProbeFailure(error: unknown) {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String((error as NodeJS.ErrnoException).code ?? '')
    if (code === 'ENOENT') {
      return '未在 PATH 中找到命令'
    }
  }

  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : '无法启动命令'
}

async function probeCli(definition: AgentDefinition): Promise<AgentAvailability> {
  const probe = CLI_PROBES[definition.id]

  if (!probe) {
    return {
      available: true,
      command: null,
      definition,
      reason: null,
      version: null,
    }
  }

  const environment = createExternalCliEnvironment()
  const command = resolveExternalCliCommand(probe.command, environment)
  if (!command) {
    return {
      available: false,
      command: probe.command,
      definition,
      reason: '未在 PATH 中找到命令',
      version: null,
    }
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(command, probe.versionArgs, {
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const finish = (availability: AgentAvailability) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(availability)
    }
    const timeout = setTimeout(() => {
      terminateChildProcessTree(child)
      finish({
        available: false,
        command,
        definition,
        reason: `检测超时（${PROBE_TIMEOUT_MS / 1000} 秒）`,
        version: null,
      })
    }, PROBE_TIMEOUT_MS)

    child.stdout?.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-16_384)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_384)
    })
    child.once('error', (error) => {
      finish({
        available: false,
        command,
        definition,
        reason: formatProbeFailure(error),
        version: null,
      })
    })
    child.once('close', (code) => {
      const version = code === 0 ? normalizeVersionOutput(stdout, stderr) : null
      const versionIsCompatible = definition.id !== 'opencode'
        || isCompatibleOpenCodeVersion(version)
      finish({
        available: code === 0 && versionIsCompatible,
        command,
        definition,
        reason: code === 0 && !versionIsCompatible
          ? formatOpenCodeVersionCompatibilityError(version)
          : code === 0
            ? null
          : normalizeVersionOutput('', stderr) ?? `命令退出码为 ${code ?? 'unknown'}`,
        version,
      })
    })
  })
}

export async function discoverAgentCatalog(options: { force?: boolean } = {}) {
  const now = Date.now()
  if (!options.force && cachedCatalog && cachedCatalog.expiresAt > now) {
    return structuredClone(cachedCatalog.value)
  }

  if (!catalogDiscovery) {
    catalogDiscovery = (async () => {
      await prepareExternalCliEnvironment()
      const catalog = await Promise.all(AGENT_DEFINITIONS.map(probeCli))
      cachedCatalog = {
        expiresAt: Date.now() + DISCOVERY_CACHE_DURATION_MS,
        value: catalog,
      }
      return catalog
    })()
  }
  const discovery = catalogDiscovery
  try {
    return structuredClone(await discovery)
  } finally {
    if (catalogDiscovery === discovery) catalogDiscovery = null
  }
}

export function clearAgentCatalogCache() {
  cachedCatalog = null
}
