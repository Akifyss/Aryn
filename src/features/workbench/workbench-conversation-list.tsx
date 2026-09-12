import { EditLine } from '@mingcute/react'
import { AppButton } from '@/components/app-button'
import { AgentProvider, AgentSessionTree } from '@/features/agent/components/agent-sidebar/agent-sidebar'
import type { WorkbenchConversationConfiguration } from './workbench-conversations'
import { openWorkbenchProjectSession, type WorkbenchPaneId } from './workbench-state'

// Reuse the project session browser, including its rows and management menus.
export function WorkbenchConversationList({ pane, configuration }: {
  pane: WorkbenchPaneId
  configuration: WorkbenchConversationConfiguration
}) {
  const project = configuration.selectedProject
  return (
    <section className='workbench-conversation-list' aria-label={project ? `${project.name}的对话` : '项目对话'}>
      <AppButton variant='ghost' className='workbench-conversation-list-new' onClick={() => {
        if (project) openWorkbenchProjectSession(pane, project)
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
        surfaceMode='docked'
        onOpenProjectSession={(_, agentId, sessionPath, sessionLabel) => (
          openWorkbenchProjectSession(pane, project, { agentId, sessionPath, sessionLabel })
        )}
      >
        <AgentSessionTree
          id={`workbench-${pane}-project-sessions`}
          scope='current-project'
          openSessionsInPlace={false}
          otherPaneAction={{
            direction: pane === 'left' ? 'right' : 'left',
            onOpenSession: (agentId, sessionPath, sessionLabel) => {
              openWorkbenchProjectSession(pane === 'left' ? 'right' : 'left', project, { agentId, sessionPath, sessionLabel }, 'target')
            },
          }}
        />
      </AgentProvider> : null}
    </section>
  )
}
