import { useEffect, useState, type ComponentProps } from 'react'
import { AgentProvider, AgentChatSurface } from '@/features/agent/components/agent-sidebar/agent-sidebar'
import { useAgentContext } from '@/features/agent/components/agent-sidebar/agent-sidebar-context'
import { hasAgentComposerPayload } from '@/features/agent/composer/use-agent-composer-draft'
import type { ProjectRecord, WorkspaceNode } from '@/features/workspace/types'
import { openDuoProjectSession, useDuoStore, type DuoPaneId, type DuoTab } from './duo-state'

export type DuoConversationConfiguration = Pick<ComponentProps<typeof AgentProvider>,
  'iconTheme' | 'theme' | 'onOpenProviderSettings' | 'projectState' | 'onOpenProjectSwitchMenu' | 'onWorkspaceStateChange'
> & { selectedProject?: ProjectRecord | null; onChooseProject?: () => void }

function ConversationCloseGuard({ register, confirm }: {
  register: (guard: () => Promise<boolean>) => void
  confirm: () => Promise<boolean>
}) {
  const { composerState, composerAttachments, isConversationMaterializing } = useAgentContext()
  // Register current state synchronously; a close press must see the latest keystroke.
  register(async () => !isConversationMaterializing && (
    !hasAgentComposerPayload(composerState, composerAttachments) || await confirm()
  ))
  return null
}

function ProjectSessionPersistence({ pane, tabId, requestHandled }: { pane: DuoPaneId; tabId: string; requestHandled: boolean }) {
  const { activeSessionSelection, isSessionLoading, isLoading } = useAgentContext()
  useEffect(() => {
    if (!requestHandled || isLoading || isSessionLoading || activeSessionSelection.kind !== 'session') return
    useDuoStore.getState().setProjectSession(pane, tabId, activeSessionSelection)
  }, [pane, tabId, requestHandled, activeSessionSelection, isSessionLoading, isLoading])
  return null
}

export function DuoConversationView({ pane, tab, configuration, publishWorkspaceState, onOpenFile, registerCloseGuard, confirmClose }: {
  pane: DuoPaneId
  tab: Extract<DuoTab, { kind: 'conversation' }>
  configuration: DuoConversationConfiguration
  publishWorkspaceState: boolean
  onOpenFile: (path: string, workspacePath: string | null) => void
  registerCloseGuard: (guard: () => Promise<boolean>) => void
  confirmClose: () => Promise<boolean>
}) {
  const workspacePath = tab.projectSession?.project.path ?? null
  const [handledRequestId, setHandledRequestId] = useState<number | null>(null)
  const sessionRequest = tab.projectSession?.request
  const [tree, setTree] = useState<WorkspaceNode[]>([])
  useEffect(() => {
    let cancelled = false
    setTree([])
    if (workspacePath) {
      void window.appApi.loadWorkspaceTree(workspacePath).then((nodes) => {
        if (!cancelled) setTree(nodes)
      }).catch(() => { /* Runtime surfaces report unavailable workspaces. */ })
    }
    return () => { cancelled = true }
  }, [workspacePath])
  if (!tab.projectSession) return null
  return (
    <AgentProvider
      {...configuration}
      onWorkspaceStateChange={publishWorkspaceState ? configuration.onWorkspaceStateChange : undefined}
      activeWorkspaceContext={{ kind: 'project', projectId: tab.projectSession.project.id }}
      workspacePath={workspacePath}
      externalSessionRequest={sessionRequest?.requestId === handledRequestId ? null : sessionRequest}
      onExternalSessionRequestHandled={setHandledRequestId}
      preserveComposerOnNavigation
      workspaceTreeOverride={tree}
      autoOpenChangedFiles={false}
      isAgentLayout
      surfaceMode='docked'
      onStartStandaloneConversation={undefined}
      onStartProjectSession={(project) => openDuoProjectSession(pane, project)}
      onOpenConversation={undefined}
      onOpenProjectSession={(project, agentId, sessionPath, sessionLabel) => openDuoProjectSession(pane, project, { agentId, sessionPath, sessionLabel })}
      onOpenMessageFile={(path) => onOpenFile(path, workspacePath)}
      onCreateConversationWorkspace={undefined}
    >
      <ConversationCloseGuard register={registerCloseGuard} confirm={confirmClose} />
      <ProjectSessionPersistence pane={pane} tabId={tab.id} requestHandled={handledRequestId === sessionRequest?.requestId} />
      <AgentChatSurface />
    </AgentProvider>
  )
}
