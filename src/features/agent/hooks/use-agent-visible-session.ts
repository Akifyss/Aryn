import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
} from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import {
  buildNativeOptimisticUserMessages,
  reconcileOptimisticAgentUserMessages,
  type OptimisticAgentUserMessage,
} from '@/features/agent/lib/optimistic-user-messages'
import type { AgentSessionSelection } from '@/features/agent/lib/project-session-request'
import { normalizeAgentProjectPath } from '@/features/agent/lib/session-tree'
import type {
  AgentRuntimeState,
  AgentSessionListItem,
  AgentSessionSnapshot,
  CodexNativeSessionSnapshot,
  OpenCodeNativeSessionSnapshot,
  PiWebNativeSessionSnapshot,
} from '@/features/agent/types'

function getVisibleRuntime(
  runtime: AgentRuntimeState,
  isViewingActiveRuntime: boolean,
): AgentRuntimeState {
  if (isViewingActiveRuntime) {
    return runtime
  }

  return {
    ...runtime,
    compactionReason: null,
    followUpMessageCount: 0,
    followUpMessages: [],
    isCompacting: false,
    isStreaming: false,
    pendingMessageCount: 0,
    retryAttempt: 0,
    retryMaxAttempts: null,
    steeringMessageCount: 0,
    steeringMessages: [],
  }
}

type UseAgentVisibleSessionOptions = {
  activeSessionSelection: AgentSessionSelection
  activeSessionSnapshot: AgentSessionSnapshot | null
  optimisticUserMessages: OptimisticAgentUserMessage[]
  runtime: AgentRuntimeState
  selectedAgentId: AgentId
  sessions: AgentSessionListItem[]
  setOptimisticUserMessages: Dispatch<SetStateAction<OptimisticAgentUserMessage[]>>
  viewedSessionSnapshot: AgentSessionSnapshot | null
  workspacePath: string | null
}

export function useAgentVisibleSession({
  activeSessionSelection,
  activeSessionSnapshot,
  optimisticUserMessages,
  runtime,
  selectedAgentId,
  sessions,
  setOptimisticUserMessages,
  viewedSessionSnapshot,
  workspacePath,
}: UseAgentVisibleSessionOptions) {
  const activeSessionPath = activeSessionSelection.kind === 'session'
    ? activeSessionSelection.sessionPath
    : null
  const activeSession = activeSessionPath && runtime.agentId === selectedAgentId
    ? sessions.find((session) => session.path === activeSessionPath) ?? null
    : null

  useEffect(() => {
    if (!activeSessionSnapshot) {
      return
    }

    setOptimisticUserMessages((current) => reconcileOptimisticAgentUserMessages(
      current,
      runtime.agentId,
      activeSessionSnapshot,
    ))
  }, [activeSessionSnapshot, runtime.agentId, setOptimisticUserMessages])

  const isViewingActiveRuntime = Boolean(
    activeSessionPath
    && runtime.agentId === selectedAgentId
    && activeSessionSnapshot?.sessionPath === activeSessionPath,
  )
  const viewedSessionForSelection = viewedSessionSnapshot?.sessionPath === activeSessionPath
    ? viewedSessionSnapshot
    : null
  const visibleSessionSnapshot = isViewingActiveRuntime
    ? activeSessionSnapshot
    : viewedSessionForSelection
  const visibleRuntime = useMemo(
    () => getVisibleRuntime(runtime, isViewingActiveRuntime),
    [isViewingActiveRuntime, runtime],
  )
  const visiblePersistedMessages = visibleSessionSnapshot?.messages ?? []
  const codexNativeSession: CodexNativeSessionSnapshot | null = workspacePath
    && visibleSessionSnapshot
    && normalizeAgentProjectPath(visibleSessionSnapshot.workspacePath) === normalizeAgentProjectPath(workspacePath)
    && visibleSessionSnapshot.native?.agentId === 'codex'
    ? visibleSessionSnapshot.native
    : null
  const openCodeNativeSession: OpenCodeNativeSessionSnapshot | null = visibleSessionSnapshot?.native?.agentId === 'opencode'
    ? visibleSessionSnapshot.native
    : null
  const piWebNativeSession: PiWebNativeSessionSnapshot | null = visibleSessionSnapshot?.native?.agentId === 'pi'
    || visibleSessionSnapshot?.native?.agentId === 'builtin-pi'
    ? visibleSessionSnapshot.native
    : null
  const visibleOptimisticEntries = useMemo(() => (
    activeSessionSelection.kind === 'session'
      ? optimisticUserMessages.filter((entry) => (
          entry.agentId === activeSessionSelection.agentId
          && entry.sessionPath === activeSessionSelection.sessionPath
        ))
      : []
  ), [activeSessionSelection, optimisticUserMessages])
  const nativeOptimisticMessages = useMemo(
    () => buildNativeOptimisticUserMessages(visibleOptimisticEntries),
    [visibleOptimisticEntries],
  )

  return {
    activeSession,
    activeSessionPath,
    codexNativeSession,
    codexOptimisticUserMessages: nativeOptimisticMessages.codex,
    isOpenCodeChildSession: Boolean(openCodeNativeSession?.parentSessionId),
    isViewingActiveRuntime,
    openCodeNativeSession,
    openCodeOptimisticUserMessages: nativeOptimisticMessages.openCode,
    piWebNativeSession,
    piWebOptimisticUserMessages: nativeOptimisticMessages.piWeb,
    visiblePersistedMessages,
    visibleRuntime,
    visibleSessionSnapshot,
  }
}
