import { type Dispatch, type RefObject, type SetStateAction, useState } from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import {
  createAgentModelDraft,
  getAgentModelKey,
  getRuntimeDefaultModelDraft,
  getRuntimeSelectedModelDraft,
  normalizeAgentModelDraft,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import type { AgentSessionSelection } from '@/features/agent/lib/project-session-request'
import type { AgentThinkingLevel, AgentWorkspaceState } from '@/features/agent/types'

type UseAgentModelMutationsOptions = {
  model: {
    modelInputValue: string
    resolvedSelectedProviderValue: string
    selectedThinkingLevel: AgentThinkingLevel
    syncModelDraft: (draft: AgentModelDraft) => void
    syncNewSessionModelDraft: (draft: AgentModelDraft) => void
  }
  navigation: {
    activeSessionSelectionRef: RefObject<AgentSessionSelection>
    ensureSelectedAgentSessionActive: (
      selection?: AgentSessionSelection,
    ) => Promise<AgentWorkspaceState | null>
    isAgentSessionOperationCurrent: (
      agentId: AgentId,
      sessionPath: string,
      workspacePath: string,
    ) => boolean
    selectedAgentId: AgentId
    workspacePath: string | null
  }
  state: {
    agentState: AgentWorkspaceState
    canUseDraftRuntimeWithoutWorkspace: boolean
    closeModelMenu: () => void
    setAgentState: Dispatch<SetStateAction<AgentWorkspaceState>>
    setPanelError: Dispatch<SetStateAction<string | null>>
  }
}

export function useAgentModelMutations({
  model: {
    modelInputValue,
    resolvedSelectedProviderValue,
    selectedThinkingLevel,
    syncModelDraft,
    syncNewSessionModelDraft,
  },
  navigation: {
    activeSessionSelectionRef,
    ensureSelectedAgentSessionActive,
    isAgentSessionOperationCurrent,
    selectedAgentId,
    workspacePath,
  },
  state: {
    agentState,
    canUseDraftRuntimeWithoutWorkspace,
    closeModelMenu,
    setAgentState,
    setPanelError,
  },
}: UseAgentModelMutationsOptions) {
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const [isSwitchingThinkingLevel, setIsSwitchingThinkingLevel] = useState(false)

  async function handleSelectModel(modelKey: string) {
    if (!workspacePath && !canUseDraftRuntimeWithoutWorkspace) {
      return
    }

    const requestAgentId = selectedAgentId
    const requestWorkspacePath = workspacePath
    const requestSelection = activeSessionSelectionRef.current
    let requestSessionPath: string | null = null

    try {
      setIsSwitchingModel(true)
      setPanelError(null)
      const nextDraft = normalizeAgentModelDraft(
        createAgentModelDraft(modelKey, selectedThinkingLevel),
        agentState.runtime,
        getRuntimeDefaultModelDraft(agentState.runtime),
      )
      if (requestSelection.kind === 'new') {
        syncNewSessionModelDraft(nextDraft)
        syncModelDraft(nextDraft)
        closeModelMenu()
        return
      }

      const activeState = await ensureSelectedAgentSessionActive(requestSelection)
      if (!activeState?.activeSession) {
        if (
          requestWorkspacePath
          && isAgentSessionOperationCurrent(requestAgentId, requestSelection.sessionPath, requestWorkspacePath)
        ) {
          setPanelError('Open a session before switching the model.')
          closeModelMenu()
        }
        return
      }

      if (!requestWorkspacePath) {
        setPanelError('Open a workspace before switching the model.')
        return
      }

      const activeSessionPath = activeState.activeSession.sessionPath
      if (!activeSessionPath) {
        setPanelError('The active session does not have a native session identifier.')
        return
      }
      requestSessionPath = activeSessionPath
      const nextState = await window.appApi.selectAgentModel({
        agentId: requestAgentId,
        sessionPath: activeSessionPath,
        workspacePath: requestWorkspacePath,
      }, modelKey)
      if (
        !isAgentSessionOperationCurrent(requestAgentId, activeSessionPath, requestWorkspacePath)
        || nextState.activeSession?.sessionPath !== activeSessionPath
      ) {
        return
      }

      setAgentState(nextState)
      syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
      closeModelMenu()
    } catch (error) {
      if (
        !requestSessionPath
        || !requestWorkspacePath
        || isAgentSessionOperationCurrent(requestAgentId, requestSessionPath, requestWorkspacePath)
      ) {
        setPanelError(error instanceof Error ? error.message : 'Unable to switch the model.')
      }
    } finally {
      setIsSwitchingModel(false)
    }
  }

  async function handleThinkingLevelSelection(level: AgentThinkingLevel, modelKey?: string) {
    if (!workspacePath && !canUseDraftRuntimeWithoutWorkspace) {
      return
    }

    const nextModelKey = modelKey?.trim()
      ?? getAgentModelKey(resolvedSelectedProviderValue, modelInputValue.trim())

    if (!nextModelKey || !agentState.runtime.availableModels.includes(nextModelKey)) {
      setPanelError('Select an available model before changing the thinking level.')
      closeModelMenu()
      return
    }

    const requestAgentId = selectedAgentId
    const requestWorkspacePath = workspacePath
    const requestSelection = activeSessionSelectionRef.current
    let requestSessionPath: string | null = null

    try {
      setIsSwitchingThinkingLevel(true)
      setPanelError(null)
      const nextDraft = normalizeAgentModelDraft(
        createAgentModelDraft(nextModelKey, level),
        agentState.runtime,
        getRuntimeDefaultModelDraft(agentState.runtime),
      )
      if (requestSelection.kind === 'new') {
        syncNewSessionModelDraft(nextDraft)
        syncModelDraft(nextDraft)
        closeModelMenu()
        return
      }

      const activeState = await ensureSelectedAgentSessionActive(requestSelection)
      if (!activeState?.activeSession) {
        if (
          requestWorkspacePath
          && isAgentSessionOperationCurrent(requestAgentId, requestSelection.sessionPath, requestWorkspacePath)
        ) {
          setPanelError('Open a session before changing the thinking level.')
          closeModelMenu()
        }
        return
      }

      if (!requestWorkspacePath) {
        setPanelError('Open a workspace before changing the thinking level.')
        return
      }

      const activeSessionPath = activeState.activeSession.sessionPath
      if (!activeSessionPath) {
        setPanelError('The active session does not have a native session identifier.')
        return
      }
      requestSessionPath = activeSessionPath
      const nextState = await window.appApi.selectAgentThinkingLevel({
        agentId: requestAgentId,
        sessionPath: activeSessionPath,
        workspacePath: requestWorkspacePath,
      }, level, nextModelKey)
      if (
        !isAgentSessionOperationCurrent(requestAgentId, activeSessionPath, requestWorkspacePath)
        || nextState.activeSession?.sessionPath !== activeSessionPath
      ) {
        return
      }

      setAgentState(nextState)
      syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
      closeModelMenu()
    } catch (error) {
      if (
        !requestSessionPath
        || !requestWorkspacePath
        || isAgentSessionOperationCurrent(requestAgentId, requestSessionPath, requestWorkspacePath)
      ) {
        setPanelError(error instanceof Error ? error.message : 'Unable to switch the thinking level.')
      }
    } finally {
      setIsSwitchingThinkingLevel(false)
    }
  }

  return {
    handleSelectModel,
    handleThinkingLevelSelection,
    isSwitchingModel,
    isSwitchingThinkingLevel,
  }
}
