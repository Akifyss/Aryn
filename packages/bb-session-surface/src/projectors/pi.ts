import type {
  ThreadEventItem,
  ThreadEventUserContent,
  ThreadRuntimeDisplayStatus,
  ThreadStatus,
} from '@bb/domain'
import type {
  BbNativeFileChange,
  BbNativeSessionSnapshot,
  BbOptimisticUserMessage,
} from '../contracts'
import {
  appendOptimisticEvents,
  arrayValue,
  CanonicalEventBuilder,
  fileChangeKind,
  markdownForAttachments,
  normalizeEpoch,
  normalizeLocalAttachmentPath,
  numberValue,
  recordValue,
  safeJson,
  stableFallbackEpoch,
  stringValue,
  unsupportedUserContentBlocks,
  textFromBlocks,
  uniqueContent,
  userContentFromBlocks,
} from './common'
import type { MarkdownAttachment, PersistedUserMessageIdentity } from './common'
import type { CanonicalSessionProjection } from './types'

function piToolName(block: Record<string, unknown>) {
  return stringValue(block.toolName) || stringValue(block.name) || 'Tool'
}

function piToolCallId(block: Record<string, unknown>, fallbackId: string) {
  return stringValue(block.toolCallId) || stringValue(block.id) || fallbackId
}

function piToolInput(block: Record<string, unknown>) {
  return recordValue(block.input) ?? recordValue(block.arguments)
}

function isCommandTool(name: string) {
  return ['bash', 'command', 'exec', 'shell', 'terminal'].includes(name.toLowerCase())
}

function isDelegationTool(name: string) {
  return ['task', 'subagent', 'delegate', 'delegation', 'spawn_agent'].includes(name.toLowerCase())
}

function toolResultText(message: Record<string, unknown>) {
  return textFromBlocks(message.content) || safeJson(message.details ?? '')
}

const PI_ATTACHMENT_MARKER = 'Attachments:'
const PI_CLI_FILE_REFERENCE = /(?:^|\n\n)Attached file:\s*([^\r\n]+)/g

type BuiltinPiAttachmentReference = {
  content: Exclude<ThreadEventUserContent, { type: 'text' }> | null
  fileName: string
  kind: 'file' | 'image'
  status: 'omitted' | 'referenced' | 'sent'
}

function attachmentReference(value: unknown): BuiltinPiAttachmentReference | null {
  const reference = recordValue(value)
  if (!reference) return null
  const path = normalizeLocalAttachmentPath(stringValue(reference.path))
  const fileName = stringValue(reference.fileName) || stringValue(reference.name)
  if (!fileName && !path) return null
  const kind = stringValue(reference.kind) === 'image' ? 'image' : 'file'
  const nativeStatus = stringValue(reference.status)
  const status = nativeStatus === 'sent' || nativeStatus === 'omitted' ? nativeStatus : 'referenced'
  return {
    content: path
      ? kind === 'image'
        ? { type: 'localImage', path }
        : { type: 'localFile', path }
      : null,
    fileName: fileName || path,
    kind,
    status,
  }
}

function parseBuiltinPiAttachmentLine(line: string): BuiltinPiAttachmentReference | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('- ')) return null
  const payload = trimmed.slice(2).trim()
  if (!payload.startsWith('{')) return null
  try {
    return attachmentReference(JSON.parse(payload))
  } catch {
    return null
  }
}

function markdownAttachmentsFromBlocks(value: unknown): MarkdownAttachment[] {
  return userContentFromBlocks(value).flatMap((content) => (
    content.type === 'text'
      ? []
      : [{ content }]
  ))
}

function piUserPromptText(value: unknown) {
  const rawText = typeof value === 'string' ? value : textFromBlocks(value)
  const markerMatch = /(?:^|\r?\n\r?\n)Attachments:\r?\n/.exec(rawText)
  const withoutAttachmentSection = markerMatch?.index === undefined
    ? rawText
    : rawText.slice(0, markerMatch.index)
  return withoutAttachmentSection.replace(PI_CLI_FILE_REFERENCE, '').trim()
}

function projectPiUserContent(value: unknown): ThreadEventUserContent[] {
  const content = userContentFromBlocks(value)
  const attachments: ThreadEventUserContent[] = []
  let remainingInlineImages = content.filter((entry) => (
    entry.type === 'image' || entry.type === 'localImage'
  )).length
  const projected = content.flatMap((entry): ThreadEventUserContent[] => {
    if (entry.type !== 'text') return [entry]
    let text = entry.text
    const markerMatch = /(?:^|\r?\n\r?\n)Attachments:\r?\n/.exec(text)
    if (markerMatch?.index !== undefined) {
      const sectionStart = markerMatch.index + markerMatch[0].length
      const attachmentSection = text.slice(sectionStart)
      const unparsedLines: string[] = []
      const notices: string[] = []
      for (const line of attachmentSection.split('\n')) {
        const reference = parseBuiltinPiAttachmentLine(line)
        if (reference) {
          if (reference.status === 'omitted') {
            notices.push(`${reference.kind === 'image' ? 'Image' : 'Attachment'} not sent to the model: ${reference.fileName}`)
          } else if (reference.kind === 'image' && reference.status === 'sent' && remainingInlineImages > 0) {
            remainingInlineImages -= 1
          } else if (reference.content) {
            attachments.push(reference.content)
          } else {
            notices.push(`${reference.kind === 'image' ? 'Image attachment' : 'Attachment'} unavailable: ${reference.fileName}`)
          }
          continue
        }
        const trimmedLine = line.trim()
        if (/^\[Image: original \d+x\d+, displayed at \d+x\d+\./.test(trimmedLine)) continue
        if (trimmedLine) unparsedLines.push(line)
      }
      const promptText = text.slice(0, markerMatch.index).trimEnd()
      text = [
        promptText,
        notices.join('\n'),
        unparsedLines.length ? `${PI_ATTACHMENT_MARKER}\n${unparsedLines.join('\n')}` : '',
      ].filter(Boolean).join('\n\n')
    }

    text = text.replace(PI_CLI_FILE_REFERENCE, (_match, path: string) => {
      const normalizedPath = normalizeLocalAttachmentPath(path)
      if (normalizedPath) attachments.push({ type: 'localFile', path: normalizedPath })
      return ''
    }).trim()
    return text ? [{ type: 'text', text }] : []
  })
  return uniqueContent([...projected, ...attachments])
}

function resultByToolCall(messages: unknown[]) {
  const results = new Map<string, Record<string, unknown>>()
  for (const value of messages) {
    const message = recordValue(value)
    if (stringValue(message?.role) !== 'toolResult') continue
    const callId = stringValue(message?.toolCallId)
    if (callId && message) results.set(callId, message)
  }
  return results
}

function piToolItem(
  block: Record<string, unknown>,
  blockId: string,
  result: Record<string, unknown> | undefined,
  streaming: boolean,
): ThreadEventItem {
  const callId = piToolCallId(block, blockId)
  const name = piToolName(block)
  const input = piToolInput(block)
  const output = result ? toolResultText(result) : ''
  const isError = result?.isError === true
  const status = result ? isError ? 'failed' : 'completed' : streaming ? 'pending' : 'interrupted'
  if (isCommandTool(name)) {
    const exitCode = numberValue(recordValue(result?.details)?.exitCode)
    return {
      type: 'commandExecution',
      id: callId,
      command: stringValue(input?.command) || stringValue(input?.cmd) || name,
      cwd: stringValue(input?.cwd),
      status,
      approvalStatus: null,
      ...(output ? { aggregatedOutput: output } : {}),
      ...(exitCode === null ? {} : { exitCode }),
    }
  }
  return {
    type: 'toolCall',
    id: callId,
    tool: isDelegationTool(name) ? 'Task' : name,
    arguments: isDelegationTool(name)
      ? { ...(input ?? {}), nativeTool: name }
      : input ?? undefined,
    status,
    ...(output ? { result: output } : {}),
    ...(isError ? { error: output || 'Tool call failed' } : {}),
  }
}

export function projectPiSnapshot(
  snapshot: BbNativeSessionSnapshot,
  optimisticMessages: BbOptimisticUserMessage[],
  nativeFileChanges: BbNativeFileChange[],
  projectionRevision: number,
): CanonicalSessionProjection {
  const sessionId = stringValue(snapshot.sessionId) || `${snapshot.agentId}-session`
  const messages = arrayValue(snapshot.messages)
  const entryIds = arrayValue(snapshot.entryIds)
  const firstTimestamp = normalizeEpoch(
    recordValue(messages[0])?.timestamp,
    stableFallbackEpoch(`${snapshot.agentId}:${sessionId}`),
  )
  const providerId = snapshot.agentId === 'builtin-pi' ? 'builtin-pi' : 'pi'
  const builder = new CanonicalEventBuilder(sessionId, providerId, sessionId, firstTimestamp, projectionRevision)
  const persistedMessages: PersistedUserMessageIdentity[] = []
  const pairedToolResults = new Set<string>()
  const toolResults = resultByToolCall(messages)
  const runtimeStatus: ThreadRuntimeDisplayStatus = snapshot.isStreaming === true ? 'active' : 'idle'
  let currentTurnId: string | null = null
  let currentTurnStartedAt = firstTimestamp
  builder.threadStarted(firstTimestamp)

  const finishCurrentTurn = (timestamp: number) => {
    if (!currentTurnId) return
    builder.turnCompleted(currentTurnId, 'completed', timestamp)
    currentTurnId = null
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = recordValue(messages[messageIndex])
    const entryId = stringValue(entryIds[messageIndex]) || `message-${messageIndex}`
    const timestamp = normalizeEpoch(message?.timestamp, firstTimestamp + messageIndex * 100)
    const role = stringValue(message?.role)
    if (!message) {
      builder.unhandled(entryId, 'pi/message', messages[messageIndex], currentTurnId, timestamp)
      continue
    }

    if (role === 'user') {
      finishCurrentTurn(timestamp - 1)
      currentTurnId = entryId
      currentTurnStartedAt = timestamp
      const content = projectPiUserContent(message.content)
      const text = content.filter((entry) => entry.type === 'text').map((entry) => entry.text).join('\n\n')
      persistedMessages.push({
        allowContentTimestampMatch: true,
        ids: [...new Set([entryId, stringValue(message.id)].filter(Boolean))],
        text: piUserPromptText(message.content) || text,
        timestamp,
      })
      builder.userRequest(currentTurnId, entryId, content, timestamp)
      for (const { index, value } of unsupportedUserContentBlocks(message.content)) {
        builder.unhandled(
          `${entryId}:user-block-${index}`,
          `pi/user/${stringValue(recordValue(value)?.type) || 'block'}`,
          value,
          currentTurnId,
          timestamp + index / 100,
        )
      }
      continue
    }

    if (role === 'toolResult') {
      const callId = stringValue(message.toolCallId)
      if (!pairedToolResults.has(callId)) {
        builder.unhandled(entryId, `pi/tool-result/${stringValue(message.toolName) || callId}`, message, currentTurnId, timestamp)
      } else {
        for (let blockIndex = 0; blockIndex < arrayValue(message.content).length; blockIndex += 1) {
          const block = recordValue(arrayValue(message.content)[blockIndex])
          if (stringValue(block?.type) === 'text') continue
          if (markdownAttachmentsFromBlocks([block]).length) continue
          builder.unhandled(
            `${entryId}:result-block-${blockIndex}`,
            `pi/tool-result/${stringValue(block?.type) || 'block'}`,
            arrayValue(message.content)[blockIndex],
            currentTurnId,
            timestamp + blockIndex / 100,
          )
        }
      }
      continue
    }

    if (!currentTurnId) {
      currentTurnId = `pi:turn:${entryId}`
      currentTurnStartedAt = timestamp
      builder.turnStarted(currentTurnId, timestamp)
    }

    if (role === 'assistant') {
      const blocks = arrayValue(message.content)
      for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
        const block = recordValue(blocks[blockIndex])
        const blockId = `${entryId}:block-${blockIndex}`
        const blockTimestamp = timestamp + blockIndex / 100
        if (!block) {
          builder.unhandled(blockId, 'pi/assistant-block', blocks[blockIndex], currentTurnId, blockTimestamp)
          continue
        }
        const isLastStreamingBlock = runtimeStatus === 'active'
          && messageIndex === messages.length - 1
          && blockIndex === blocks.length - 1
        let item: ThreadEventItem | null = null
        let projectedAttachments: MarkdownAttachment[] = []
        let terminal = !isLastStreamingBlock
        switch (stringValue(block.type)) {
          case 'text':
            item = { type: 'agentMessage', id: blockId, text: stringValue(block.text) }
            break
          case 'thinking':
            item = {
              type: 'reasoning',
              id: blockId,
              summary: [stringValue(block.thinking)].filter(Boolean),
              content: block.deferred === true && !stringValue(block.thinking)
                ? ['Historical reasoning is available in the native view.']
                : [],
            }
            break
          case 'toolCall': {
            const callId = piToolCallId(block, blockId)
            const result = toolResults.get(callId)
            if (result) pairedToolResults.add(callId)
            item = piToolItem(block, blockId, result, runtimeStatus === 'active')
            projectedAttachments = markdownAttachmentsFromBlocks(result?.content)
            terminal = Boolean(result) || runtimeStatus !== 'active'
            break
          }
          case 'image': {
            const text = markdownForAttachments(markdownAttachmentsFromBlocks([block]), 'Attachment')
            if (text) item = { type: 'agentMessage', id: blockId, text }
            else builder.unhandled(blockId, 'pi/image', block, currentTurnId, blockTimestamp)
            break
          }
          default:
            builder.unhandled(blockId, `pi/${stringValue(block.type) || 'assistant-block'}`, block, currentTurnId, blockTimestamp)
        }
        if (item) {
          const parentToolCallId = stringValue(block.parentToolCallId)
          const projectedItem = parentToolCallId
            ? { ...item, parentToolCallId } as ThreadEventItem
            : item
          builder.item(currentTurnId, projectedItem, terminal, blockTimestamp)
          if (projectedItem.type === 'commandExecution') {
            const input = piToolInput(block)
            const terminalInput = stringValue(input?.terminalInput) || stringValue(input?.stdin)
            if (terminalInput) {
              builder.unhandled(
                `${blockId}:terminal-input`,
                'pi/command/terminalInput',
                { input: terminalInput },
                currentTurnId,
                blockTimestamp + 0.001,
              )
            }
          }
          const attachmentText = markdownForAttachments(projectedAttachments, 'Tool attachments')
          if (attachmentText) {
            builder.item(currentTurnId, {
              type: 'agentMessage',
              id: `${projectedItem.id}:attachments`,
              text: attachmentText,
            }, true, blockTimestamp + 0.0001)
          }
        }
      }
      const error = stringValue(message.errorMessage)
      if (error) builder.providerError(`${entryId}:error`, error, currentTurnId, timestamp)
      continue
    }

    if (role === 'custom') {
      if (stringValue(message.customType).toLowerCase().includes('compaction')) {
        builder.item(currentTurnId, {
          type: 'contextCompaction',
          id: `${entryId}:compaction`,
        }, true, timestamp)
        const details = stringValue(message.summary) || stringValue(message.content)
        if (details) {
          builder.providerWarning(`${entryId}:compaction-summary`, 'Context compacted', currentTurnId, timestamp, details)
        }
        continue
      }
      builder.unhandled(entryId, `pi/custom/${stringValue(message.customType) || 'message'}`, message, currentTurnId, timestamp)
      continue
    }
    if (role === 'bashExecution') {
      const exitCode = numberValue(message.exitCode)
      builder.item(currentTurnId, {
        type: 'commandExecution',
        id: entryId,
        command: stringValue(message.command) || 'Command',
        cwd: stringValue(message.cwd),
        status: exitCode !== null && exitCode !== 0 ? 'failed' : 'completed',
        approvalStatus: null,
        ...(stringValue(message.output) ? { aggregatedOutput: stringValue(message.output) } : {}),
        ...(exitCode === null ? {} : { exitCode }),
      }, true, timestamp)
      const terminalInput = stringValue(message.terminalInput) || stringValue(message.stdin)
      if (terminalInput) {
        builder.unhandled(
          `${entryId}:terminal-input`,
          'pi/bashExecution/terminalInput',
          { input: terminalInput },
          currentTurnId,
          timestamp + 0.001,
        )
      }
      continue
    }
    if (role === 'compactionSummary') {
      builder.item(currentTurnId, {
        type: 'contextCompaction',
        id: `${entryId}:compaction`,
      }, true, timestamp)
      const details = stringValue(message.summary) || stringValue(message.content)
      if (details) {
        builder.providerWarning(`${entryId}:compaction-summary`, 'Context compacted', currentTurnId, timestamp, details)
      }
      continue
    }
    if (role === 'branchSummary') {
      builder.providerWarning(
        `${entryId}:branch-summary`,
        'Conversation branch summary',
        currentTurnId,
        timestamp,
        stringValue(message.summary) || stringValue(message.content) || safeJson(message),
      )
      continue
    }
    builder.unhandled(entryId, `pi/${role || 'message'}`, message, currentTurnId, timestamp)
  }

  if (nativeFileChanges.length) {
    if (!currentTurnId) {
      currentTurnId = 'pi:file-changes'
      currentTurnStartedAt = firstTimestamp + messages.length * 100
      builder.turnStarted(currentTurnId, currentTurnStartedAt)
    }
    for (let index = 0; index < nativeFileChanges.length; index += 1) {
      const change = nativeFileChanges[index]!
      builder.item(currentTurnId, {
        type: 'fileChange',
        id: `pi:file-change-${index}:${change.path}`,
        changes: [{
          path: change.path,
          kind: fileChangeKind(change.kind),
          ...(change.diff ? { diff: change.diff } : {}),
          ...(change.movePath ? { movePath: change.movePath } : {}),
        }],
        status: 'completed',
        approvalStatus: null,
      }, true, currentTurnStartedAt + index)
    }
  }

  if (currentTurnId && runtimeStatus !== 'active') {
    finishCurrentTurn(firstTimestamp + messages.length * 100 + nativeFileChanges.length)
  }
  appendOptimisticEvents({ builder, optimisticMessages, persistedMessages })

  const threadStatus: ThreadStatus = runtimeStatus === 'active' ? 'active' : 'idle'
  return {
    contextWindowEvents: [],
    events: builder.events,
    providerDisplayName: snapshot.agentId === 'builtin-pi' ? 'Aryn' : 'PI',
    providerId,
    runtimeStatus,
    threadName: '',
    threadStatus,
  }
}
