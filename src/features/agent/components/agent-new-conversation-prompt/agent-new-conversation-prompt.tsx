import { AgentTypeSwitch } from '@/features/agent/components/agent-type-switch/agent-type-switch'
import {
  AgentProjectSwitchTrigger,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import { useAgentContext } from '@/features/agent/components/agent-sidebar/agent-sidebar-context'
import './styles.css'

function AgentTypeSwitchTrigger({
  menuPortalTarget,
}: {
  menuPortalTarget?: HTMLElement | null
}) {
  const {
    activeSessionSelection,
    activeWorkspaceContext,
    agentCatalog,
    agentCatalogRefreshError,
    refreshAgentCatalog,
    selectedAgentId,
    setSelectedAgentId,
  } = useAgentContext()
  const isLocked = activeWorkspaceContext.kind === 'conversation'
    || activeSessionSelection.kind === 'session'

  return (
    <AgentTypeSwitch
      agentCatalog={agentCatalog}
      isLocked={isLocked}
      menuPortalTarget={menuPortalTarget}
      refreshError={agentCatalogRefreshError}
      selectedAgentId={selectedAgentId}
      // This trigger is inline with the 24px hero heading.
      triggerIconSize={24}
      onRefresh={refreshAgentCatalog}
      onSelect={setSelectedAgentId}
    />
  )
}

type AgentNewConversationPromptProps = {
  menuPortalTarget?: HTMLElement | null
}

export function AgentNewConversationPrompt({
  menuPortalTarget,
}: AgentNewConversationPromptProps) {
  const {
    activeWorkspaceContext,
    onOpenProjectSwitchMenu,
    projectState,
  } = useAgentContext()
  const activeProject = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
    : null

  return (
    <div className='agent-new-conversation-prompt'>
      <h2>
        {activeProject ? (
          <>
            <span>今天在</span>
            <AgentProjectSwitchTrigger
              activeProject={activeProject}
              onOpenProjectSwitchMenu={onOpenProjectSwitchMenu}
            />
            <span>使用</span>
            <AgentTypeSwitchTrigger menuPortalTarget={menuPortalTarget} />
            <span>处理什么？</span>
          </>
        ) : (
          <>
            <span>今天使用</span>
            <AgentTypeSwitchTrigger menuPortalTarget={menuPortalTarget} />
            <span>处理些什么？</span>
          </>
        )}
      </h2>
    </div>
  )
}
