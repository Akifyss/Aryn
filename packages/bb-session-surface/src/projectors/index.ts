import {
  buildThreadTimelineFromEvents,
  compactThreadTimelineSummaryEvents,
} from '@bb/thread-view'
import type {
  BbInteractionTimelineRecord,
  BbNativeFileChange,
  BbNativeSessionSnapshot,
  BbOptimisticUserMessage,
  BbSessionRuntimeState,
} from '../contracts'
import { CanonicalEventBuilder, stableFallbackEpoch, stringValue } from './common'
import { projectCodexSnapshot } from './codex'
import { projectOpenCodeSnapshot } from './opencode'
import { projectPiSnapshot } from './pi'
import type { CanonicalSessionProjection, TimelineProjection } from './types'

type CanonicalEventEntry = CanonicalSessionProjection['events'][number]

function interactionMatchesNativeLifecycle(
  entry: CanonicalEventEntry,
  record: BbInteractionTimelineRecord,
) {
  const event = entry.event
  const candidateIds = new Set([
    record.request.id,
    record.request.itemId,
  ].filter((value): value is string => Boolean(value)))
  if (record.request.kind === 'question' && event.type === 'system/userQuestion/lifecycle') {
    return candidateIds.has(event.interactionId) || candidateIds.has(event.providerRequestId)
  }
  if (record.request.kind === 'permission' && event.type === 'system/permissionGrant/lifecycle') {
    return candidateIds.has(event.interactionId)
      || candidateIds.has(event.providerRequestId)
      || candidateIds.has(event.subject.itemId)
  }
  return false
}

function extractNativeInteractionLifecycles(
  events: CanonicalSessionProjection['events'],
  records: readonly BbInteractionTimelineRecord[],
) {
  const extracted = new Map<string, CanonicalEventEntry[]>()
  for (const record of records) {
    const matches: CanonicalEventEntry[] = []
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const entry = events[index]
      if (!entry || !interactionMatchesNativeLifecycle(entry, record)) continue
      matches.unshift(...events.splice(index, 1))
    }
    if (matches.length) extracted.set(record.request.id, matches)
  }
  return extracted
}

function nativeInteractionTurnId(entries: CanonicalEventEntry[] | undefined) {
  const entry = entries?.[0]
  return entry?.event.scope.kind === 'turn' ? entry.event.scope.turnId : null
}

function nativeInteractionQuestions(entries: CanonicalEventEntry[] | undefined) {
  const questions = (entries ?? []).flatMap((entry) => (
    entry.event.type === 'system/userQuestion/lifecycle'
      ? entry.event.payload.questions.map((question) => ({
          id: question.id,
          prompt: question.prompt,
          multiSelect: question.multiSelect,
          ...(question.options ? { options: question.options } : {}),
          allowFreeText: question.allowFreeText,
        }))
      : []
  ))
  return questions.length ? questions : null
}

function canonicalTurnAssociations(events: CanonicalSessionProjection['events']) {
  const turns: Array<{ startedAt: number; turnId: string }> = []
  const itemToTurn = new Map<string, string>()
  for (const { event, meta } of events) {
    if (event.type === 'turn/started' && event.scope.kind === 'turn') {
      turns.push({ startedAt: meta.createdAt, turnId: event.scope.turnId })
    }
    if (
      (event.type === 'item/started' || event.type === 'item/completed')
      && event.scope.kind === 'turn'
    ) {
      itemToTurn.set(event.item.id, event.scope.turnId)
    }
  }
  turns.sort((left, right) => left.startedAt - right.startedAt)
  return { itemToTurn, turns }
}

export function projectNativeSession({
  fileChanges,
  interactionRecords = [],
  optimisticMessages,
  projectionRevision = 0,
  sessionId,
  snapshot,
  runtimeState,
  workspacePath = null,
}: {
  fileChanges: BbNativeFileChange[]
  interactionRecords?: BbInteractionTimelineRecord[]
  optimisticMessages: BbOptimisticUserMessage[]
  projectionRevision?: number
  sessionId: string
  snapshot: BbNativeSessionSnapshot
  runtimeState?: BbSessionRuntimeState
  workspacePath?: string | null
}): TimelineProjection {
  let canonical: CanonicalSessionProjection
  switch (snapshot.agentId) {
    case 'codex':
      canonical = projectCodexSnapshot(snapshot, optimisticMessages, projectionRevision)
      break
    case 'opencode':
      canonical = projectOpenCodeSnapshot(snapshot, optimisticMessages, sessionId, projectionRevision)
      break
    case 'builtin-pi':
    case 'pi':
      canonical = projectPiSnapshot(
        runtimeState?.isStreaming ? { ...snapshot, isStreaming: true } : snapshot,
        optimisticMessages,
        fileChanges,
        projectionRevision,
      )
      break
  }

  const sessionInteractionRecords = [...interactionRecords]
    .filter(({ request }) => request.sessionId === sessionId)
    .sort((left, right) => left.requestedAt - right.requestedAt)
  const nativeInteractionLifecycles = extractNativeInteractionLifecycles(
    canonical.events,
    sessionInteractionRecords,
  )

  const deterministicFallback = stableFallbackEpoch(`${snapshot.agentId}:${sessionId}:host`)
  const canonicalLastTimestamp = canonical.events.reduce(
    (latest, entry) => Math.max(latest, entry.meta.createdAt),
    deterministicFallback,
  )
  const hostFallbackTime = canonicalLastTimestamp + 1
  const hostBuilder = new CanonicalEventBuilder(
    sessionId,
    canonical.providerId,
    sessionId,
    hostFallbackTime,
    projectionRevision + 1,
  )
  const associations = canonicalTurnAssociations(canonical.events)
  let latestTurnId = [...canonical.events].reverse().find(({ event }) => event.scope.kind === 'turn')?.event.scope
  const ensureHostTurnId = () => {
    if (latestTurnId?.kind === 'turn') return latestTurnId.turnId
    const turnId = `host:${sessionId}`
    hostBuilder.turnStarted(turnId, hostFallbackTime)
    latestTurnId = { kind: 'turn', turnId }
    associations.turns.push({ startedAt: hostFallbackTime, turnId })
    return turnId
  }

  const resolveInteractionTurnId = (record: BbInteractionTimelineRecord) => {
    if (record.request.turnId) return record.request.turnId
    if (record.request.itemId) {
      const itemTurnId = associations.itemToTurn.get(record.request.itemId)
      if (itemTurnId) return itemTurnId
    }
    const timestampTurn = [...associations.turns]
      .reverse()
      .find((turn) => turn.startedAt <= record.requestedAt)
    return timestampTurn?.turnId ?? ensureHostTurnId()
  }

  const live = runtimeState?.streaming
  if (
    runtimeState?.isStreaming
    && (snapshot.agentId === 'pi' || snapshot.agentId === 'builtin-pi')
    && live
  ) {
    const turnId = ensureHostTurnId()
    const startedAt = live.startedAt ?? hostFallbackTime
    if (live.thinkingText) {
      hostBuilder.item(turnId, {
        type: 'reasoning',
        id: `host:live:${sessionId}:reasoning`,
        summary: [],
        content: [live.thinkingText.endsWith('\n') ? live.thinkingText : `${live.thinkingText}\n`],
      }, false, startedAt)
    }
    for (let index = 0; index < (live.tools ?? []).length; index += 1) {
      const tool = live.tools![index]!
      const terminal = tool.status === 'done' || tool.status === 'error'
      hostBuilder.item(turnId, {
        type: 'toolCall',
        id: `host:live:${tool.id}`,
        tool: tool.name || 'Tool',
        status: tool.status === 'error'
          ? 'failed'
          : terminal
            ? 'completed'
            : 'pending',
        ...(terminal && tool.summary ? { result: tool.summary } : {}),
        ...(tool.status === 'error' ? { error: tool.summary || 'Tool call failed' } : {}),
      }, terminal, tool.startedAt ?? startedAt + index + 1)
      if (!terminal && tool.summary) {
        hostBuilder.toolProgress(
          turnId,
          `host:live:${tool.id}`,
          [tool.summary],
          false,
          tool.startedAt ?? startedAt + index + 1,
        )
      }
    }
    if (live.assistantText) {
      hostBuilder.item(turnId, {
        type: 'agentMessage',
        id: `host:live:${sessionId}:assistant`,
        text: live.assistantText,
      }, false, startedAt + (live.tools?.length ?? 0) + 2)
    }
  }

  for (const record of sessionInteractionRecords) {
    const nativeLifecycle = nativeInteractionLifecycles.get(record.request.id)
    const turnId = nativeInteractionTurnId(nativeLifecycle) ?? resolveInteractionTurnId(record)
    if (record.request.kind === 'question') {
      const fields = record.request.fields?.length
        ? record.request.fields
        : [{
            id: record.request.id,
            label: record.request.title,
            message: record.request.message,
            options: record.request.options,
            allowsCustomAnswer: record.request.options.length === 0,
          }]
      const questions = (record.request.fields?.length ? null : nativeInteractionQuestions(nativeLifecycle))
        ?? fields.map((field) => ({
          id: field.id,
          prompt: field.message || field.label || record.request.message,
          multiSelect: field.multiSelect === true,
          ...(field.options?.length ? {
            options: field.options.map((option) => ({
              value: option.id,
              label: option.label,
              ...(option.description ? { description: option.description } : {}),
            })),
          } : {}),
          allowFreeText: field.allowsCustomAnswer === true || !field.options?.length,
        }))
      const answers = record.status === 'resolved'
        ? Object.fromEntries(questions.map((question, questionIndex) => {
            const field = fields.find((candidate) => candidate.id === question.id)
            if (field?.isSecret) {
              return [question.id || `${record.request.id}:${questionIndex}`, { selected: [] }]
            }
            const values = record.response?.answers?.[question.id]
              ?? (questions.length === 1 ? record.response?.values : undefined)
              ?? []
            const optionIds = new Set((question.options ?? []).map((option) => option.value))
            const selected = values.filter((value) => optionIds.has(value))
            if (questions.length === 1 && record.response?.optionId && optionIds.has(record.response.optionId)) {
              selected.push(record.response.optionId)
            }
            const freeValues = values.filter((value) => !optionIds.has(value))
            return [question.id || `${record.request.id}:${questionIndex}`, {
              selected: [...new Set(selected)],
              ...(freeValues.length ? { freeText: freeValues.join('\n') } : {}),
            }]
          }))
        : undefined
      hostBuilder.userQuestion(
        record.request.id,
        turnId,
        questions,
        record.status,
        record.resolvedAt ?? record.requestedAt,
        record.statusReason,
        answers,
      )
      continue
    }

    const selected = stringValue(record.response?.optionId).toLowerCase()
    const denied = /deny|reject|decline|cancel/.test(selected)
    const nativePermissionLifecycle = nativeLifecycle?.find((entry) => (
      entry.event.type === 'system/permissionGrant/lifecycle'
    ))
    const nativeToolName = nativePermissionLifecycle?.event.type === 'system/permissionGrant/lifecycle'
      ? nativePermissionLifecycle.event.subject.toolName
      : null
    hostBuilder.permission(
      record.request.id,
      turnId,
      nativeToolName || record.request.title || record.request.message,
      record.status,
      record.resolvedAt ?? record.requestedAt,
      denied,
      record.statusReason,
    )
  }

  const executionState = runtimeState?.executionState
  const isRetrying = executionState?.type === 'retry'
  const isActive = runtimeState?.isStreaming === true
    || runtimeState?.isCompacting === true
    || executionState?.type === 'busy'
    || isRetrying
  const runtimeError = stringValue(runtimeState?.error)
  if (isRetrying) {
    const turnId = ensureHostTurnId()
    const attempt = executionState.attempt ?? runtimeState?.retryAttempt ?? 0
    const max = runtimeState?.retryMaxAttempts
    const action = executionState.action
    const details = [
      executionState.message,
      action?.title,
      action?.message,
      action?.reason,
    ].filter(Boolean).join(' — ')
    hostBuilder.providerError(
      `host:retry:${attempt}`,
      `Retrying${attempt ? ` (attempt ${attempt}${max ? `/${max}` : ''})` : ''}${details ? `: ${details}` : ''}`,
      turnId,
      hostFallbackTime + 100,
      true,
    )
  }
  if (runtimeState?.isCompacting) {
    const turnId = ensureHostTurnId()
    hostBuilder.item(turnId, {
      type: 'contextCompaction',
      id: `host:compaction:${runtimeState.compactionReason ?? 'runtime'}`,
    }, false, hostFallbackTime + 101)
  }
  if (runtimeError) {
    hostBuilder.providerError(
      'host:runtime-error',
      runtimeError,
      latestTurnId?.kind === 'turn' ? latestTurnId.turnId : null,
      hostFallbackTime + 102,
    )
  }
  if (hostBuilder.events.length) canonical.events.push(...hostBuilder.events)
  if (runtimeState?.isStopping) {
    canonical.runtimeStatus = 'stopping'
    canonical.threadStatus = 'stopping'
  } else if (isActive) {
    canonical.runtimeStatus = 'active'
    canonical.threadStatus = 'active'
  } else if (runtimeError) {
    canonical.runtimeStatus = 'error'
    canonical.threadStatus = 'error'
  }

  // Everything after the provider boundary is the exact vendored bb flow:
  // summary compaction, ordering, turn grouping, streaming buffers, lifecycle
  // aggregation, activity classification, and TimelineRow construction.
  const timeline = buildThreadTimelineFromEvents({
    acceptedClientRequestContext: { acceptedClientRequestEvents: [] },
    contextWindowEvents: canonical.contextWindowEvents,
    events: compactThreadTimelineSummaryEvents(canonical.events),
    options: {
      includeDebugRawEvents: false,
      includeNestedRows: true,
      includeProviderUnhandledOperations: true,
      isLatestPage: true,
      providerDisplayName: canonical.providerDisplayName,
      providerId: canonical.providerId,
      threadStatus: canonical.threadStatus,
      threadName: canonical.threadName,
      turnMessageDetail: 'full',
      workspaceRoot: workspacePath,
    },
  })

  return {
    activeThinking: timeline.activeThinking,
    isStopping: runtimeState?.isStopping === true,
    ongoingIndicatorLabel: runtimeState?.isCompacting
      ? 'Compacting context'
      : isRetrying
        ? `Retrying${executionState.attempt ? ` (attempt ${executionState.attempt})` : ''}`
        : timeline.activeThinking
          ? undefined
          : 'Working',
    rows: timeline.rows,
    runtimeStatus: canonical.runtimeStatus,
    ...(runtimeState?.stoppingAnchorAt === undefined ? {} : { stoppingAnchorAt: runtimeState.stoppingAnchorAt }),
  }
}
