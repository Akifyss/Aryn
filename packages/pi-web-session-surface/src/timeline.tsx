import { useState, type ReactNode } from 'react'
import { MessageView } from '@/components/MessageView'
import {
  countToolCallBlocks,
  getDisplayableAssistantBlocks,
  splitFinalAssistantBlocks,
} from '@/lib/message-display'
import type {
  AgentMessage,
  AssistantContentBlock,
  AssistantMessage,
  ToolResultMessage,
} from '@/lib/types'
import type { PiWebAgentPhase } from './session-state'

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== 'assistant') return false
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === 'image' || (block.type === 'text' && block.text.trim().length > 0)
  ))
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx -= 1) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx -= 1) {
    if (messages[candidateIdx]?.role === 'assistant') return candidateIdx
  }
  return -1
}

function countToolCalls(messages: AgentMessage[], indices: number[]): number {
  let count = 0
  for (const index of indices) {
    const message = messages[index]
    if (message?.role !== 'assistant') continue
    count += countToolCallBlocks(getDisplayableAssistantBlocks(message as AssistantMessage))
  }
  return count
}

function hasDisplayableProcessMessage(message: AgentMessage): boolean {
  if (message.role === 'assistant') {
    return getDisplayableAssistantBlocks(message as AssistantMessage).length > 0
  }
  return message.role === 'custom'
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content }
  if (options.omitUsage) next.usage = undefined
  return next
}

function ProcessDetailsGroup({
  children,
  messageCount,
  toolCallCount,
}: {
  children: ReactNode
  messageCount: number
  toolCallCount: number
}) {
  const [expanded, setExpanded] = useState(false)
  const parts = ['Process details', `${messageCount} ${messageCount === 1 ? 'message' : 'messages'}`]
  if (toolCallCount > 0) parts.push(`${toolCallCount} ${toolCallCount === 1 ? 'tool call' : 'tool calls'}`)

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        className='aryn-pi-web-session-surface__process-toggle'
        type='button'
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        style={{
          alignItems: 'center',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          display: 'flex',
          fontSize: 12,
          gap: 8,
          minHeight: 24,
          padding: '2px 0',
          textAlign: 'left',
          width: 'auto',
        }}
        title={expanded ? 'Collapse process details' : 'Expand process details'}
      >
        <svg aria-hidden='true' className='aryn-pi-web-session-surface__process-toggle-icon' width='12' height='12' viewBox='0 0 12 12' fill='none' stroke='currentColor' strokeWidth='1.6' strokeLinecap='round' strokeLinejoin='round' style={{ flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points='4 2.5 7.5 6 4 9.5' />
        </svg>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {parts.join(' · ')}
        </span>
      </button>
      {expanded ? <div style={{ marginTop: 8 }}>{children}</div> : null}
    </div>
  )
}

function phaseLabel(phase: PiWebAgentPhase) {
  if (phase?.kind === 'running_tools') {
    const names = phase.tools.map((tool) => tool.name)
    if (names.length === 0) return 'Running tool...'
    if (names.length === 1) return `Running ${names[0]}...`
    if (names.length <= 3) return `Running ${names.join(', ')}...`
    return `Running ${names.slice(0, 2).join(', ')} (+${names.length - 2})...`
  }
  if (phase?.kind === 'waiting_model') return 'Waiting for model...'
  if (phase?.kind === 'running_command') return 'Running command...'
  return 'Thinking...'
}

export function PiWebTimeline({
  agentPhase,
  agentRunning,
  entryIds,
  messages,
  modelNames,
  onOpenFile,
  sessionId,
  streamingMessage,
  workspacePath,
}: {
  agentPhase: PiWebAgentPhase
  agentRunning: boolean
  entryIds: string[]
  messages: AgentMessage[]
  modelNames: Record<string, string>
  onOpenFile?: (filePath: string) => void
  sessionId: string
  streamingMessage: Partial<AgentMessage> | null
  workspacePath: string
}) {
  const toolResultsMap = new Map<string, ToolResultMessage>()
  for (const message of messages) {
    if (message.role === 'toolResult') {
      toolResultsMap.set((message as ToolResultMessage).toolCallId, message as ToolResultMessage)
    }
  }

  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') {
      lastUserIndex = index
      break
    }
  }

  const renderMessage = (
    index: number,
    options: { keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean } = {},
  ) => {
    const message = options.messageOverride ?? messages[index]
    let showTimestamp = false
    if (message.role === 'assistant') {
      showTimestamp = true
      for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
        const role = messages[nextIndex].role
        if (role === 'user') break
        if (role === 'assistant') {
          showTimestamp = false
          break
        }
      }
      if (showTimestamp && streamingMessage && index === messages.length - 1) showTimestamp = false
    }
    if (options.showTimestamp !== undefined) showTimestamp = options.showTimestamp
    return (
      <MessageView
        key={`${options.keyPrefix ?? 'message'}-${index}`}
        message={message}
        toolResults={toolResultsMap}
        modelNames={modelNames}
        cwd={workspacePath}
        onOpenFile={onOpenFile}
        entryId={entryIds[index] || undefined}
        showTimestamp={showTimestamp}
        prevTimestamp={index > 0 ? messages[index - 1].timestamp : undefined}
        sessionId={sessionId}
      />
    )
  }

  const rendered: ReactNode[] = []
  for (let index = 0; index < messages.length;) {
    const message = messages[index]
    if (message.role !== 'user') {
      rendered.push(renderMessage(index))
      index += 1
      continue
    }

    const userIndex = index
    let endIndex = userIndex + 1
    while (endIndex < messages.length && messages[endIndex].role !== 'user') endIndex += 1
    const finalAssistantIndex = findFinalAssistantIndex(messages, userIndex, endIndex)

    if (finalAssistantIndex === -1) {
      for (let renderIndex = userIndex; renderIndex < endIndex; renderIndex += 1) {
        rendered.push(renderMessage(renderIndex))
      }
      index = endIndex
      continue
    }

    const isLiveTail = (agentRunning || Boolean(streamingMessage))
      && endIndex === messages.length
      && userIndex === lastUserIndex
    if (isLiveTail) {
      for (let renderIndex = userIndex; renderIndex < endIndex; renderIndex += 1) {
        rendered.push(renderMessage(renderIndex))
      }
      index = endIndex
      continue
    }

    rendered.push(renderMessage(userIndex))
    const processIndices: number[] = []
    for (let processIndex = userIndex + 1; processIndex < finalAssistantIndex; processIndex += 1) {
      processIndices.push(processIndex)
    }
    const visibleProcessIndices = processIndices.filter((processIndex) => (
      hasDisplayableProcessMessage(messages[processIndex])
    ))
    const finalAssistant = messages[finalAssistantIndex] as AssistantMessage
    const finalSplit = splitFinalAssistantBlocks(finalAssistant)
    const finalProcessMessage = finalSplit.processBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.processBlocks, { omitUsage: true })
      : null
    const finalAnswerMessage = finalSplit.answerBlocks.length > 0
      ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
      : null

    const processCount = visibleProcessIndices.length + (finalProcessMessage ? 1 : 0)
    if (processCount > 0) {
      rendered.push(
        <ProcessDetailsGroup
          key={`process-group-${userIndex}-${finalAssistantIndex}`}
          messageCount={processCount}
          toolCallCount={countToolCalls(messages, visibleProcessIndices) + countToolCallBlocks(finalSplit.processBlocks)}
        >
          {visibleProcessIndices.map((processIndex) => renderMessage(processIndex, { keyPrefix: 'process' }))}
          {finalProcessMessage ? renderMessage(finalAssistantIndex, {
            keyPrefix: 'process-final',
            messageOverride: finalProcessMessage,
            showTimestamp: false,
          }) : null}
        </ProcessDetailsGroup>,
      )
    }
    if (finalAnswerMessage) {
      rendered.push(renderMessage(finalAssistantIndex, { messageOverride: finalAnswerMessage }))
    }
    for (let renderIndex = finalAssistantIndex + 1; renderIndex < endIndex; renderIndex += 1) {
      rendered.push(renderMessage(renderIndex))
    }
    index = endIndex
  }

  return (
    <div className='aryn-pi-web-session-surface__timeline'>
      {rendered}
      {streamingMessage ? (
        <MessageView
          message={streamingMessage as AgentMessage}
          isStreaming
          modelNames={modelNames}
          cwd={workspacePath}
          onOpenFile={onOpenFile}
        />
      ) : null}
      {agentRunning && !streamingMessage ? (
        <div
          aria-atomic='true'
          aria-live='polite'
          className='aryn-pi-web-session-surface__phase'
          role='status'
        >
          <span>{phaseLabel(agentPhase)}</span>
        </div>
      ) : null}
    </div>
  )
}
