import type { ThreadRuntimeDisplayStatus } from '@bb/domain'

export type RuntimeAnnouncementState = {
  isStopping: boolean
  label?: string
  status: ThreadRuntimeDisplayStatus
}

export function runtimeAnnouncementKey({
  isStopping,
  label,
  status,
}: RuntimeAnnouncementState) {
  if (isStopping || status === 'stopping') return 'stopping'
  if (status === 'error') return 'error'
  if (status === 'active') return `active:${label?.trim() || 'working'}`
  return status
}

export function runtimeAnnouncementMessage(key: string, previousKey: string | null) {
  if (key === 'stopping') return 'Agent is stopping.'
  if (key === 'error') return 'Agent encountered an error.'
  if (key === 'starting') return 'Agent is starting.'
  if (key === 'provisioning') return 'Agent environment is provisioning.'
  if (key === 'host-reconnecting') return 'Reconnecting to agent host.'
  if (key === 'waiting-for-host') return 'Waiting for agent host.'
  if (key === 'idle') {
    if (previousKey?.startsWith('active:') || previousKey === 'stopping') {
      return 'Agent finished working.'
    }
    if (previousKey && previousKey !== 'idle' && previousKey !== 'error') {
      return 'Agent is ready.'
    }
    return ''
  }
  const label = key.slice('active:'.length)
  return label.toLocaleLowerCase() === 'working' ? 'Agent is working.' : `${label}.`
}
