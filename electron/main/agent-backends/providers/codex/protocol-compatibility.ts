import type { ServerNotification } from '../../../../../src/features/agent/codex-protocol/generated/ServerNotification'

export function getCodexNotificationThreadId(notification: ServerNotification) {
  return notification.method === 'thread/started'
    ? notification.params.thread.id
    : 'threadId' in notification.params && typeof notification.params.threadId === 'string'
      ? notification.params.threadId
      : null
}

export function isRecoverableCodexModelsCacheError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const explicitSchemaFailure = message.includes('failed to load models cache:')
    && /missing field|unknown field|invalid type|expected .+ at line|EOF while parsing/i.test(message)
  // Some Codex versions only write an incompatible-cache diagnostic to their
  // own log stream and leave model/list pending. Recovery remains bounded to
  // one attempt and only removes a cache file when one actually exists.
  const modelListTimeout = /codex request ["']model\/list["'] timed out/i.test(message)
  return explicitSchemaFailure || modelListTimeout
}

export function isTransientCodexThreadReadError(message: string) {
  return message.includes('is not materialized yet')
    || (message.includes('failed to load rollout') && message.includes('is empty'))
}

export function isMissingNativeCodexThreadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no rollout found') || message.includes('not found')
}

export function isCodexServiceTierCompatibilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('service_tier') || (
    message.includes('unknown variant `default`')
    && message.includes('expected `fast` or `flex`')
  )
}
