import type {
  AgentQueuedMessageUpdate,
  AgentRunningPromptBehavior,
} from '../../../../shared/agent-contracts/types'

type AgentQueuedMessageKind = AgentRunningPromptBehavior

export type AgentQueueSnapshot = {
  followUp: string[]
  steering: string[]
}

export function applyAgentQueuedMessageUpdate(
  queue: AgentQueueSnapshot,
  update: AgentQueuedMessageUpdate,
): AgentQueueSnapshot {
  validateAgentQueuedMessageUpdate(update, queue)
  const nextQueue: AgentQueueSnapshot = {
    followUp: [...queue.followUp],
    steering: [...queue.steering],
  }
  const sourceQueue = getAgentQueueMessages(nextQueue, update.kind)
  const [message] = sourceQueue.splice(update.index, 1)
  if (!message) throw new Error('Queued message has already been processed.')
  if (update.action === 'edit') sourceQueue.splice(update.index, 0, update.text.trim())
  else if (update.action === 'move') {
    getAgentQueueMessages(nextQueue, update.targetKind).push(message)
  }
  return nextQueue
}

function getAgentQueueMessages(queue: AgentQueueSnapshot, kind: AgentQueuedMessageKind) {
  return kind === 'steer' ? queue.steering : queue.followUp
}

function validateAgentQueuedMessageUpdate(
  update: AgentQueuedMessageUpdate,
  queue: AgentQueueSnapshot,
) {
  if (update.kind !== 'steer' && update.kind !== 'followUp') {
    throw new Error('Unknown queued message type.')
  }
  if (update.action !== 'delete' && update.action !== 'edit' && update.action !== 'move') {
    throw new Error('Unknown queued message action.')
  }
  if (!Number.isInteger(update.index) || update.index < 0) {
    throw new Error('Queued message index is invalid.')
  }
  if (!update.expectedText.trim()) throw new Error('Queued message text is empty.')
  if (update.action === 'edit' && !update.text.trim()) {
    throw new Error('Queued message cannot be empty.')
  }
  if (update.action === 'move' && update.targetKind !== 'steer' && update.targetKind !== 'followUp') {
    throw new Error('Unknown queued message target.')
  }
  const messages = getAgentQueueMessages(queue, update.kind)
  if (messages[update.index] !== update.expectedText) {
    throw new Error('Queued message changed before this action completed. Please try again.')
  }
}
