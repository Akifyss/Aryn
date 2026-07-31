import type { Session } from '@opencode-ai/sdk/v2'
import type { AgentThinkingLevel } from '../../../../shared/agent-contracts/types'
import type { SessionRuntimeLease } from '../../runtime/session-runtime-coordinator'
import {
  createSessionRuntimeKey as runtimeKey,
  createWorkspaceIdentity as workspaceIdentity,
} from '../../runtime/runtime-keys'
import {
  DEFAULT_OPEN_CODE_THINKING_LEVEL as DEFAULT_THINKING_LEVEL,
  getSessionConfigurationFromMetadata as sessionConfigurationFromMetadata,
  type OpenCodeSessionRecord,
} from './session-model'
import type { OpenCodeSessionBinding } from './runtime'

/** Owns OpenCode binding identity and hierarchy, but not native lifecycle work. */
export class OpenCodeBindingRegistry {
  private readonly bindings = new Map<string, OpenCodeSessionBinding>()

  values() {
    return this.bindings.values()
  }

  install(binding: OpenCodeSessionBinding) {
    this.bindings.set(runtimeKey(binding.cwd, binding.sessionId), binding)
  }

  remove(binding: OpenCodeSessionBinding) {
    const key = runtimeKey(binding.cwd, binding.sessionId)
    if (this.bindings.get(key) !== binding) return false
    this.bindings.delete(key)
    return true
  }

  current(cwd: string, sessionId: string) {
    const binding = this.bindings.get(runtimeKey(cwd, sessionId)) ?? null
    return binding && this.isCurrent(binding) ? binding : null
  }

  find(sessionId: string, cwd?: string) {
    if (cwd) {
      const binding = this.current(cwd, sessionId)
      if (binding) return binding
    }
    for (const binding of this.bindings.values()) {
      if (
        binding.sessionId === sessionId
        && (!cwd || workspaceIdentity(binding.cwd) === workspaceIdentity(cwd))
        && this.isCurrent(binding)
      ) return binding
    }
    return null
  }

  descendants(cwd: string, ancestorSessionId: string) {
    const identity = workspaceIdentity(cwd)
    const discoveredSessionIds = new Set([ancestorSessionId])
    const descendants: OpenCodeSessionBinding[] = []
    let discoveredAnotherGeneration = true
    while (discoveredAnotherGeneration) {
      discoveredAnotherGeneration = false
      for (const binding of this.bindings.values()) {
        if (
          discoveredSessionIds.has(binding.sessionId)
          || workspaceIdentity(binding.cwd) !== identity
          || !binding.parentSessionId
          || !discoveredSessionIds.has(binding.parentSessionId)
        ) continue
        discoveredSessionIds.add(binding.sessionId)
        descendants.push(binding)
        discoveredAnotherGeneration = true
      }
    }
    return descendants
  }

  isCurrent(binding: OpenCodeSessionBinding) {
    return binding.lease.isCurrent()
      && binding.ownerLease.isCurrent()
      && binding.parentLease.isCurrent()
      && this.bindings.get(runtimeKey(binding.cwd, binding.sessionId)) === binding
  }

  create(
    cwd: string,
    session: Session,
    lease: SessionRuntimeLease,
    record?: OpenCodeSessionRecord,
    rootSessionId = session.id,
    ownerLease = lease,
    parentLease = lease,
  ): OpenCodeSessionBinding {
    const officialConfiguration = sessionConfigurationFromMetadata(session)
    return {
      cwd,
      executionState: { type: 'idle' },
      isStreaming: false,
      lastAssistantMessageId: null,
      lease,
      ownerLease,
      parentLease,
      parentSessionId: session.parentID ?? null,
      rootSessionId,
      selectedModel: officialConfiguration?.modelKey
        ?? record?.modelKey
        ?? (session.model ? `${session.model.providerID}/${session.model.id}` : null),
      sessionId: session.id,
      thinkingLevel: officialConfiguration?.thinkingLevel
        ?? record?.thinkingLevel
        ?? (session.model?.variant && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(session.model.variant)
          ? session.model.variant as AgentThinkingLevel
          : DEFAULT_THINKING_LEVEL),
      title: session.title ?? null,
    }
  }

  merge(
    binding: OpenCodeSessionBinding,
    session: Session,
    record?: OpenCodeSessionRecord,
    rootSessionId = binding.rootSessionId,
    ownerLease = binding.ownerLease,
    parentLease = binding.parentLease,
  ) {
    const officialConfiguration = sessionConfigurationFromMetadata(session)
    binding.ownerLease = ownerLease
    binding.parentLease = parentLease
    binding.parentSessionId = session.parentID ?? null
    binding.rootSessionId = rootSessionId
    binding.selectedModel = officialConfiguration?.modelKey
      ?? binding.selectedModel
      ?? record?.modelKey
      ?? (session.model ? `${session.model.providerID}/${session.model.id}` : null)
    binding.thinkingLevel = officialConfiguration?.thinkingLevel
      ?? binding.thinkingLevel
      ?? record?.thinkingLevel
      ?? DEFAULT_THINKING_LEVEL
    binding.title = session.title ?? null
  }
}
