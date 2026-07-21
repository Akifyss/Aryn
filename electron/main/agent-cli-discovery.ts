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
  OPENCODE_PROTOCOL_VERSION,
} from '../../src/features/agent/lib/opencode-version'

const DISCOVERY_CACHE_DURATION_MS = 15_000
const PROBE_TIMEOUT_MS = 5_000
const PROBE_FORCE_KILL_DELAY_MS = 1_000
const MAX_DIAGNOSTIC_LENGTH = 512

type CliProbeDefinition = {
  command: string
  versionArgs: string[]
}

export type AgentCliProbeResult =
  | { command: string, kind: 'not-found' }
  | { command: string, kind: 'timeout' }
  | { command: string, error: unknown, kind: 'error' }
  | { code: number | null, command: string, kind: 'closed', stderr: string, stdout: string }

type AgentCatalogLoader = (options: { refreshEnvironment: boolean }) => Promise<AgentAvailability[]>

type AgentCatalogDiscoveryDependencies = {
  cacheDurationMs?: number
  loadCatalog: AgentCatalogLoader
  now?: () => number
}

type ActiveCatalogDiscovery = {
  promise: Promise<AgentAvailability[]>
  refreshEnvironment: boolean
}

const CLI_PROBES: Partial<Record<AgentDefinition['id'], CliProbeDefinition>> = {
  codex: { command: 'codex', versionArgs: ['--version'] },
  opencode: { command: 'opencode', versionArgs: ['--version'] },
  pi: { command: 'pi', versionArgs: ['--version'] },
}

function sanitizeDiagnostic(value: string) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DIAGNOSTIC_LENGTH)
}

function normalizeVersionOutput(stdout: string, stderr: string) {
  const line = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((candidate) => sanitizeDiagnostic(candidate))
    .find(Boolean)
  return line || null
}

function formatProbeFailure(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as NodeJS.ErrnoException).code ?? '')
    : ''
  if (code === 'ENOENT') return '命令在检测期间不可用'
  if (code === 'EACCES' || code === 'EPERM') return '没有执行该命令的权限'

  return '无法启动命令'
}

function commandProbeLabel(definition: AgentDefinition) {
  const probe = CLI_PROBES[definition.id]
  return probe ? `${probe.command} ${probe.versionArgs.join(' ')}` : definition.label
}

export function createAgentAvailabilityFromProbe(
  definition: AgentDefinition,
  result: AgentCliProbeResult,
): AgentAvailability {
  const commandLabel = commandProbeLabel(definition)

  if (result.kind === 'not-found') {
    return {
      available: false,
      command: result.command,
      definition,
      guidance: `安装 ${definition.label} CLI，确认 ${commandLabel} 可在终端运行。若刚修改 PATH，请重启 Aryn 后再检测。`,
      reason: '未在 PATH 中找到命令',
      version: null,
    }
  }

  if (result.kind === 'timeout') {
    return {
      available: false,
      command: result.command,
      definition,
      guidance: `先在终端运行 ${commandLabel}，排查卡住的登录或配置，再重新检测。`,
      reason: `检测超时（${PROBE_TIMEOUT_MS / 1000} 秒）`,
      version: null,
    }
  }

  if (result.kind === 'error') {
    return {
      available: false,
      command: result.command,
      definition,
      guidance: `确认 ${commandLabel} 可在终端正常运行，再重新检测。`,
      reason: formatProbeFailure(result.error),
      version: null,
    }
  }

  const version = result.code === 0
    ? normalizeVersionOutput(result.stdout, result.stderr)
    : null
  const versionIsCompatible = definition.id !== 'opencode'
    || isCompatibleOpenCodeVersion(version)

  if (result.code === 0 && versionIsCompatible) {
    return {
      available: true,
      command: result.command,
      definition,
      guidance: null,
      reason: null,
      version,
    }
  }

  if (result.code === 0) {
    return {
      available: false,
      command: result.command,
      definition,
      guidance: `安装 ${OPENCODE_PROTOCOL_VERSION} 同一 minor 系列的 OpenCode CLI，再重新检测。`,
      reason: formatOpenCodeVersionCompatibilityError(version),
      version,
    }
  }

  return {
    available: false,
    command: result.command,
    definition,
    guidance: `在终端运行 ${commandLabel}，处理命令报告的问题后再重新检测。`,
    reason: normalizeVersionOutput(result.stderr, result.stdout) ?? `命令退出码为 ${result.code ?? 'unknown'}`,
    version: null,
  }
}

async function probeCli(definition: AgentDefinition): Promise<AgentAvailability> {
  const probe = CLI_PROBES[definition.id]

  if (!probe) {
    return {
      available: true,
      command: null,
      definition,
      guidance: null,
      reason: null,
      version: null,
    }
  }

  const environment = createExternalCliEnvironment()
  const command = resolveExternalCliCommand(probe.command, environment)
  if (!command) {
    return createAgentAvailabilityFromProbe(definition, {
      command: probe.command,
      kind: 'not-found',
    })
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const detachedProcessGroup = process.platform !== 'win32'
    const child = spawn(command, probe.versionArgs, {
      detached: detachedProcessGroup,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const finish = (result: AgentCliProbeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(createAgentAvailabilityFromProbe(definition, result))
    }
    const timeout = setTimeout(() => {
      terminateChildProcessTree(child, { detachedProcessGroup, signal: 'SIGTERM' })
      if (detachedProcessGroup) {
        const forceKillTimeout = setTimeout(() => {
          terminateChildProcessTree(child, {
            allowExitedProcessGroup: true,
            detachedProcessGroup,
            signal: 'SIGKILL',
          })
        }, PROBE_FORCE_KILL_DELAY_MS)
        forceKillTimeout.unref()
      }
      finish({ command, kind: 'timeout' })
    }, PROBE_TIMEOUT_MS)

    child.stdout?.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-16_384)
    })
    child.stderr?.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_384)
    })
    child.once('error', (error) => {
      finish({ command, error, kind: 'error' })
    })
    child.once('close', (code) => {
      finish({ code, command, kind: 'closed', stderr, stdout })
    })
  })
}

async function loadAgentCatalog(options: { refreshEnvironment: boolean }) {
  await prepareExternalCliEnvironment({ force: options.refreshEnvironment })
  return Promise.all(AGENT_DEFINITIONS.map(probeCli))
}

export function createAgentCatalogDiscovery(dependencies: AgentCatalogDiscoveryDependencies) {
  const cacheDurationMs = dependencies.cacheDurationMs ?? DISCOVERY_CACHE_DURATION_MS
  const now = dependencies.now ?? Date.now
  let activeDiscovery: ActiveCatalogDiscovery | null = null
  let cacheGeneration = 0
  let queuedForcedDiscovery: Promise<AgentAvailability[]> | null = null
  let cachedCatalog: { expiresAt: number, value: AgentAvailability[] } | null = null

  const startDiscovery = (refreshEnvironment: boolean) => {
    const startingCacheGeneration = cacheGeneration
    const promise = Promise.resolve().then(() => dependencies.loadCatalog({ refreshEnvironment }))
    const active: ActiveCatalogDiscovery = { promise, refreshEnvironment }
    activeDiscovery = active

    void promise.then(
      (catalog) => {
        if (cacheGeneration !== startingCacheGeneration) return
        cachedCatalog = {
          expiresAt: now() + cacheDurationMs,
          value: structuredClone(catalog),
        }
      },
      () => undefined,
    ).finally(() => {
      if (activeDiscovery === active) activeDiscovery = null
    })

    return promise
  }

  const queueForcedDiscovery = () => {
    if (queuedForcedDiscovery) return queuedForcedDiscovery

    const queued = (async () => {
      while (activeDiscovery) {
        if (activeDiscovery.refreshEnvironment) return activeDiscovery.promise
        await activeDiscovery.promise.catch(() => undefined)
      }
      return startDiscovery(true)
    })()
    queuedForcedDiscovery = queued
    void queued.then(
      () => undefined,
      () => undefined,
    ).finally(() => {
      if (queuedForcedDiscovery === queued) queuedForcedDiscovery = null
    })
    return queued
  }

  return {
    clear() {
      cacheGeneration += 1
      cachedCatalog = null
    },
    async discover(options: { force?: boolean } = {}) {
      const force = options.force === true

      if (queuedForcedDiscovery) {
        return structuredClone(await queuedForcedDiscovery)
      }

      if (activeDiscovery) {
        if (!force || activeDiscovery.refreshEnvironment) {
          return structuredClone(await activeDiscovery.promise)
        }
        return structuredClone(await queueForcedDiscovery())
      }

      if (!force && cachedCatalog && cachedCatalog.expiresAt > now()) {
        return structuredClone(cachedCatalog.value)
      }

      return structuredClone(await startDiscovery(force))
    },
  }
}

const defaultCatalogDiscovery = createAgentCatalogDiscovery({ loadCatalog: loadAgentCatalog })

export function discoverAgentCatalog(options: { force?: boolean } = {}) {
  return defaultCatalogDiscovery.discover(options)
}

export function clearAgentCatalogCache() {
  defaultCatalogDiscovery.clear()
}
