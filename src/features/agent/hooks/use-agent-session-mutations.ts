import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useState,
} from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import { getRuntimeSelectedModelDraft, type AgentModelDraft } from '@/features/agent/lib/model-selection'
import type { AgentSessionSelection } from '@/features/agent/lib/project-session-request'
import {
  getAgentSessionTreeKey,
  normalizeAgentProjectPath,
} from '@/features/agent/lib/session-tree'
import type {
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentWorkspaceState,
} from '@/features/agent/types'

type UseAgentSessionMutationsOptions = {
  model: {
    newSessionModelDraftRef: RefObject<AgentModelDraft>
    syncModelDraft: (draft: AgentModelDraft) => void
  }
  navigation: {
    activeSessionSelectionRef: RefObject<AgentSessionSelection>
    selectedAgentIdRef: RefObject<AgentId>
    syncActiveSessionSelection: (selection: AgentSessionSelection) => void
    workspacePathRef: RefObject<string | null>
  }
  state: {
    setAgentState: Dispatch<SetStateAction<AgentWorkspaceState>>
    setPanelError: Dispatch<SetStateAction<string | null>>
    setViewedSessionSnapshot: Dispatch<SetStateAction<AgentSessionSnapshot | null>>
  }
  storeProjectAgentSessions: (
    workspacePath: string,
    agentId: AgentId,
    sessions: AgentSessionListItem[],
  ) => void
}

export function useAgentSessionMutations({
  model: {
    newSessionModelDraftRef,
    syncModelDraft,
  },
  navigation: {
    activeSessionSelectionRef,
    selectedAgentIdRef,
    syncActiveSessionSelection,
    workspacePathRef,
  },
  state: {
    setAgentState,
    setPanelError,
    setViewedSessionSnapshot,
  },
  storeProjectAgentSessions,
}: UseAgentSessionMutationsOptions) {
  const [deletingSessionPath, setDeletingSessionPath] = useState<string | null>(null)

  async function handleDeleteSession(rootPath: string, agentId: AgentId, sessionPath: string) {
    if (!rootPath) {
      return
    }

    const deletingKey = getAgentSessionTreeKey(agentId, sessionPath)
    try {
      setDeletingSessionPath(deletingKey)
      setPanelError(null)
      const nextState = await window.appApi.deleteAgentSession({
        agentId,
        workspacePath: rootPath,
      }, sessionPath)
      storeProjectAgentSessions(rootPath, agentId, nextState.sessions)
      const currentSelection = activeSessionSelectionRef.current
      const currentWorkspacePath = workspacePathRef.current
      const isCurrentWorkspaceAgent = Boolean(
        currentWorkspacePath
        && selectedAgentIdRef.current === agentId
        && normalizeAgentProjectPath(rootPath) === normalizeAgentProjectPath(currentWorkspacePath),
      )
      const isDeletingCurrentSession = Boolean(
        isCurrentWorkspaceAgent
        && currentSelection.kind === 'session'
        && currentSelection.agentId === agentId
        && currentSelection.sessionPath === sessionPath
      )
      if (isCurrentWorkspaceAgent) {
        setAgentState((currentState) => isDeletingCurrentSession
          ? nextState
          : { ...currentState, sessions: nextState.sessions })
      }
      if (isDeletingCurrentSession) {
        setViewedSessionSnapshot(null)
        const nextActiveSessionPath = nextState.activeSession?.sessionPath
        const nextSelection = nextActiveSessionPath
          && nextState.sessions.some((session) => session.path === nextActiveSessionPath)
          ? { agentId, kind: 'session' as const, sessionPath: nextActiveSessionPath }
          : { kind: 'new' as const }
        syncActiveSessionSelection(nextSelection)
        syncModelDraft(nextSelection.kind === 'session'
          ? getRuntimeSelectedModelDraft(nextState.runtime)
          : newSessionModelDraftRef.current)
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to delete that session.')
    } finally {
      setDeletingSessionPath((currentKey) => currentKey === deletingKey ? null : currentKey)
    }
  }

  async function handleRenameSession(rootPath: string, agentId: AgentId, sessionPath: string, name: string) {
    const nextName = name.trim()

    if (!nextName) {
      return
    }

    try {
      setPanelError(null)
      const nextState = await window.appApi.renameAgentSession({
        agentId,
        workspacePath: rootPath,
      }, sessionPath, nextName)
      const currentSelection = activeSessionSelectionRef.current
      const currentWorkspacePath = workspacePathRef.current
      const isCurrentWorkspace = Boolean(
        currentWorkspacePath
        && selectedAgentIdRef.current === agentId
        && normalizeAgentProjectPath(rootPath) === normalizeAgentProjectPath(currentWorkspacePath),
      )

      if (isCurrentWorkspace) {
        setAgentState((currentState) => ({ ...currentState, sessions: nextState.sessions }))
        setViewedSessionSnapshot((currentSnapshot) => (
          currentSelection.kind === 'session'
          && currentSelection.agentId === agentId
          && currentSelection.sessionPath === sessionPath
          && currentSnapshot?.sessionPath === sessionPath
            ? { ...currentSnapshot, name: nextName }
            : currentSnapshot
        ))
      }

      storeProjectAgentSessions(rootPath, agentId, nextState.sessions)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to rename that session.')
      throw error
    }
  }

  return {
    deletingSessionPath,
    handleDeleteSession,
    handleRenameSession,
  }
}
