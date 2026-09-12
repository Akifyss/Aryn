import { AppButton } from '@/components/app-button'
import { AppScrollArea } from '@/components/app-scroll-area'
import type { WorkspaceFallbackTab } from '@/features/workspace/store/use-workspace-store'
import type { WorkbenchPaneId } from './workbench-state'
import { WORKBENCH_OPEN_ACTIONS } from './workbench-open-actions'
import type { WorkbenchConversationConfiguration } from './workbench-conversations'

export const WORKBENCH_START_TAB: WorkspaceFallbackTab = {
  id: 'app://workbench/start', filePath: 'app://workbench/start', kind: 'fallback',
  title: '开始', exists: true, isDirty: false,
}

const startActions = [...WORKBENCH_OPEN_ACTIONS].reverse()

export function WorkbenchStartPage({ pane, configuration }: { pane: WorkbenchPaneId; configuration: WorkbenchConversationConfiguration }) {
  return <AppScrollArea className='workbench-start-page' contentClassName='workbench-start-page-content'>
    <section className='workbench-start-page-actions' aria-label='打开内容'>
      {startActions.map(({ id, label, Icon, open }) => (
        <AppButton key={id} variant='ghost' className='workbench-start-page-action' onClick={() => open(pane, configuration.selectedProject, configuration.onChooseProject)}>
          <Icon aria-hidden='true' />
          <span>{id === 'conversation' && !configuration.selectedProject ? '选择项目以开始对话' : label}</span>
        </AppButton>
      ))}
    </section>
  </AppScrollArea>
}
