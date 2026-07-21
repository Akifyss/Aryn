import { useEffect, useState } from 'react'
import spinners, { type BrailleSpinnerName } from 'unicode-animations'
import { AppTooltip } from '@/components/app-tooltip'
import { DEFAULT_AGENT_ID } from '@/features/agent/agent-definition'
import type { AgentWorkspaceState } from '@/features/agent/types'
import './styles.css'

type AgentSessionStatusTone = 'error' | 'running'

type AgentSessionStatusIndicator =
  | {
      kind: 'spinner'
      name: BrailleSpinnerName
    }
  | {
      kind: 'symbol'
      value: string
    }

type AgentSessionStatusBadgeKind = 'follow-up' | 'pending' | 'steer'

type AgentSessionStatusBadge = {
  kind: AgentSessionStatusBadgeKind
  indicator: Extract<AgentSessionStatusIndicator, { kind: 'spinner' }>
  label: string
  title: string
}

export type AgentSessionStatus = {
  badges?: AgentSessionStatusBadge[]
  indicator: AgentSessionStatusIndicator
  label: string
  tone: AgentSessionStatusTone
}

export type AgentSessionPhase =
  | {
      type: 'error'
      message: string
    }
  | {
      type: 'tool_execution'
    }
  | {
      type: 'compaction'
    }
  | {
      type: 'auto_retry'
    }
  | {
      type: 'thinking'
    }
  | {
      type: 'streaming'
    }
  | {
      type: 'working'
    }
  | {
      type: 'queued'
    }
  | {
      type: 'idle'
    }

type AnimatedAgentSessionStatusType = Exclude<AgentSessionPhase['type'], 'error' | 'idle'>

const AGENT_SESSION_STATUS_ANIMATIONS: Record<AnimatedAgentSessionStatusType, BrailleSpinnerName> = {
  auto_retry: 'orbit',
  compaction: 'cascade',
  queued: 'columns',
  streaming: 'braillewave',
  thinking: 'dna',
  tool_execution: 'scan',
  working: 'braille',
}

type AgentSessionPhaseRuntime = Pick<
  AgentWorkspaceState['runtime'],
  'agentId' | 'executionState' | 'hasConfiguredModels' | 'isCompacting'
>

type AgentSessionQueueCounts = Pick<
  AgentWorkspaceState['runtime'],
  'followUpMessageCount' | 'pendingMessageCount' | 'steeringMessageCount'
>

export function deriveAgentSessionPhase({
  draftAssistant,
  hasRunningTools,
  hasVisibleRunningContent,
  isStreaming,
  isThinkingStreaming,
  panelError,
  pendingMessageCount,
  retryAttempt,
  runtime,
  workspacePath,
}: {
  draftAssistant: string
  hasRunningTools: boolean
  hasVisibleRunningContent: boolean
  isStreaming: boolean
  isThinkingStreaming: boolean
  panelError: string | null
  pendingMessageCount: number
  retryAttempt: number
  runtime: AgentSessionPhaseRuntime
  workspacePath: string | null
}): AgentSessionPhase | null {
  if (!workspacePath) {
    return null
  }

  if (panelError) {
    return {
      message: panelError,
      type: 'error',
    }
  }

  if (runtime.agentId !== DEFAULT_AGENT_ID) {
    if (runtime.executionState?.type === 'retry') {
      return { type: 'auto_retry' }
    }

    if (isStreaming) {
      if (
        hasVisibleRunningContent
        || hasRunningTools
        || draftAssistant.trim()
        || isThinkingStreaming
      ) {
        return null
      }
      return { type: 'thinking' }
    }

    if (pendingMessageCount > 0) {
      return { type: 'queued' }
    }

    return runtime.hasConfiguredModels ? { type: 'idle' } : null
  }

  if (hasRunningTools) {
    return {
      type: 'tool_execution',
    }
  }

  if (runtime.isCompacting) {
    return {
      type: 'compaction',
    }
  }

  if (retryAttempt > 0) {
    return {
      type: 'auto_retry',
    }
  }

  if (isStreaming) {
    if (isThinkingStreaming && !draftAssistant.trim()) {
      return {
        type: 'thinking',
      }
    }

    if (draftAssistant.trim()) {
      return {
        type: 'streaming',
      }
    }

    return {
      type: 'working',
    }
  }

  if (pendingMessageCount > 0) {
    return {
      type: 'queued',
    }
  }

  if (!runtime.hasConfiguredModels) {
    return null
  }

  return {
    type: 'idle',
  }
}

function formatQueueCountLabel(label: string, count: number) {
  return `${label} ${count}`
}

function getPositiveQueueCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function getAgentSessionStatusBadges({
  followUpMessageCount,
  pendingMessageCount,
  steeringMessageCount,
}: AgentSessionQueueCounts): AgentSessionStatusBadge[] {
  const steerCount = getPositiveQueueCount(steeringMessageCount)
  const followUpCount = getPositiveQueueCount(followUpMessageCount)
  const pendingCount = getPositiveQueueCount(pendingMessageCount)
  const unresolvedCount = Math.max(0, pendingCount - steerCount - followUpCount)
  const badges: AgentSessionStatusBadge[] = []

  if (steerCount > 0) {
    badges.push({
      kind: 'steer',
      indicator: {
        kind: 'spinner',
        name: 'scan',
      },
      label: formatQueueCountLabel('引导', steerCount),
      title: 'steer：插入当前运行的下一轮之前，用于修正或引导正在进行的任务。',
    })
  }

  if (followUpCount > 0) {
    badges.push({
      kind: 'follow-up',
      indicator: {
        kind: 'spinner',
        name: AGENT_SESSION_STATUS_ANIMATIONS.queued,
      },
      label: formatQueueCountLabel('排队', followUpCount),
      title: 'followUp：当前 agent 停止后再执行，适合追加后续任务。',
    })
  }

  if (unresolvedCount > 0) {
    badges.push({
      kind: 'pending',
      indicator: {
        kind: 'spinner',
        name: AGENT_SESSION_STATUS_ANIMATIONS.queued,
      },
      label: formatQueueCountLabel('等待', unresolvedCount),
      title: '等待处理的消息，当前运行时没有返回更细的 steer/followUp 分类。',
    })
  }

  return badges
}

function getQueuedStatusLabel({
  followUpMessageCount,
  pendingMessageCount,
  steeringMessageCount,
}: AgentSessionQueueCounts) {
  const steerCount = getPositiveQueueCount(steeringMessageCount)
  const followUpCount = getPositiveQueueCount(followUpMessageCount)
  const pendingCount = getPositiveQueueCount(pendingMessageCount)

  if (steerCount > 0 && followUpCount === 0 && steerCount === pendingCount) {
    return '引导等待中'
  }

  if (followUpCount > 0 && steerCount === 0 && followUpCount === pendingCount) {
    return '排队等待中'
  }

  return pendingCount > 0 ? '等待处理' : '等待中'
}

export function formatAgentSessionStatus(
  phase: AgentSessionPhase,
  queueCounts: AgentSessionQueueCounts,
): AgentSessionStatus | null {
  const queueBadges = phase.type !== 'error'
    ? getAgentSessionStatusBadges(queueCounts)
    : undefined
  const badges = queueBadges && queueBadges.length > 0
    ? queueBadges
    : undefined

  switch (phase.type) {
    case 'error':
      return {
        indicator: {
          kind: 'symbol',
          value: '•',
        },
        label: 'Error',
        tone: 'error',
      }
    case 'tool_execution':
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.tool_execution,
        },
        label: 'Tool execution',
        tone: 'running',
      }
    case 'compaction':
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.compaction,
        },
        label: 'Compaction',
        tone: 'running',
      }
    case 'auto_retry':
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.auto_retry,
        },
        label: 'Auto-retry',
        tone: 'running',
      }
    case 'thinking':
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.thinking,
        },
        label: 'Thinking',
        tone: 'running',
      }
    case 'streaming':
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.streaming,
        },
        label: 'Streaming',
        tone: 'running',
      }
    case 'working':
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.working,
        },
        label: 'Working',
        tone: 'running',
      }
    case 'queued':
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.queued,
        },
        label: getQueuedStatusLabel(queueCounts),
        tone: 'running',
      }
    case 'idle':
      return null
  }
}

function UnicodeSpinner({
  className,
  name,
}: {
  className: string
  name: BrailleSpinnerName
}) {
  const spinner = spinners[name]
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    setFrameIndex(0)

    const timer = window.setInterval(() => {
      setFrameIndex((currentValue) => (currentValue + 1) % spinner.frames.length)
    }, spinner.interval)

    return () => {
      window.clearInterval(timer)
    }
  }, [name, spinner.frames.length, spinner.interval])

  return (
    <span aria-hidden='true' className={className}>
      {spinner.frames[frameIndex] ?? spinner.frames[0]}
    </span>
  )
}

function AgentSessionStatusIndicator({ status }: { status: AgentSessionStatus }) {
  if (status.indicator.kind === 'spinner') {
    return (
      <UnicodeSpinner
        className={`agent-session-status-indicator agent-session-status-indicator-${status.tone}`}
        name={status.indicator.name}
      />
    )
  }

  return (
    <span
      aria-hidden='true'
      className={`agent-session-status-indicator agent-session-status-indicator-${status.tone}`}
    >
      {status.indicator.value}
    </span>
  )
}

export function AgentSessionStatusBubble({ status }: { status: AgentSessionStatus }) {
  return (
    <article className={`agent-session-status agent-session-status-${status.tone}`}>
      <AgentSessionStatusIndicator status={status} />
      <span className={`agent-session-status-label agent-session-status-label-${status.tone}`}>
        {status.label}
      </span>
      {status.badges?.map((badge) => (
        <AppTooltip
          excludeFromTabOrder
          key={`${badge.kind}:${badge.label}`}
          tooltip={badge.title}
          triggerRole='status'
        >
          <span
            className={`agent-session-status-badge agent-session-status-badge-${badge.kind}`}
            aria-label={badge.title}
          >
            <UnicodeSpinner
              className='agent-session-status-badge-indicator'
              name={badge.indicator.name}
            />
            <span className='agent-session-status-badge-label'>{badge.label}</span>
          </span>
        </AppTooltip>
      ))}
    </article>
  )
}
