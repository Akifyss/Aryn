import { EditLine } from '@mingcute/react'
import { AppButton } from '@/components/app-button'
import { AgentProvider, AgentSessionTree } from '@/features/agent/components/agent-sidebar/agent-sidebar'
import type { DuoConversationConfiguration } from './duo-conversations'
import { openDuoProjectSession, type DuoPaneId } from './duo-state'

// Reuse the project session browser, including its rows and management menus.
export function DuoConversationList({ pane, configuration }: {
  pane: DuoPaneId
  configuration: DuoConversationConfiguration
}) {
  const project = configuration.selectedProject
  return (
    <section className='duo-conversation-list' aria-label={project ? `${project.name}的对话` : '项目对话'}>
      <AppButton variant='ghost' className='duo-conversation-list-new' onClick={() => {
        if (project) openDuoProjectSession(pane, project)
        else configuration.onChooseProject?.()
      }}>
        <EditLine aria-hidden='true' />
        {project ? '新对话' : '选择项目以开始对话'}
      </AppButton>
      {project ? <AgentProvider
        key={project.id}
        workspaceActivation='none'
        iconTheme={configuration.iconTheme}
        theme={configuration.theme}
        projectState={{ projects: [project], lastProjectId: project.id }}
        activeWorkspaceContext={{ kind: 'project', projectId: project.id }}
        workspacePath={project.path}
        workspaceTreeOverride={[]}
        autoOpenChangedFiles={false}
        isAgentLayout
        surfaceMode='docked'
        onOpenProjectSession={(_, agentId, sessionPath, sessionLabel) => (
          openDuoProjectSession(pane, project, { agentId, sessionPath, sessionLabel })
        )}
      >
        <AgentSessionTree
          id={`duo-${pane}-project-sessions`}
          scope='current-project'
          openSessionsInPlace={false}
          otherPaneAction={{
            direction: pane === 'left' ? 'right' : 'left',
            onOpenSession: (agentId, sessionPath, sessionLabel) => {
              openDuoProjectSession(pane === 'left' ? 'right' : 'left', project, { agentId, sessionPath, sessionLabel }, 'target')
            },
          }}
        />
      </AgentProvider> : null}
    </section>
  )
}
