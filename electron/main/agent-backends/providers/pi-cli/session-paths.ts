import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getAgentDir as getPiAgentDir,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { createWorkspaceIdentity } from '../../runtime-keys'
import { normalizeNullableString } from './session-model'

export function getLegacyPiSessionDirectory(agentDir: string, cwd: string) {
  const hash = createHash('sha256').update(createWorkspaceIdentity(cwd)).digest('hex').slice(0, 20)
  return path.join(agentDir, 'external', 'pi', 'sessions', hash)
}

export function resolvePiSessionDirectory(cwd: string) {
  const environmentDirectory = normalizeNullableString(process.env.PI_CODING_AGENT_SESSION_DIR)
  const configuredDirectory = environmentDirectory ?? SettingsManager.create(cwd, getPiAgentDir()).getSessionDir()
  if (configuredDirectory) {
    if (configuredDirectory === '~') return os.homedir()
    if (configuredDirectory.startsWith('~/')) return path.join(os.homedir(), configuredDirectory.slice(2))
    return path.isAbsolute(configuredDirectory)
      ? configuredDirectory
      : path.resolve(cwd, configuredDirectory)
  }
  // Keep this encoding byte-for-byte compatible with PI's official
  // getDefaultSessionDir implementation (not part of its public exports).
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return path.join(getPiAgentDir(), 'sessions', safePath)
}

export function resolvePiPermissionExtensionPath() {
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  if (resourcesPath) {
    const packagedPath = path.join(resourcesPath, 'agent-extensions', 'pi-permission-gate.mjs')
    if (existsSync(packagedPath)) return packagedPath
  }
  return path.resolve(process.cwd(), 'resources', 'agent-extensions', 'pi-permission-gate.mjs')
}
