import { AppButton } from '@/components/app-button'
import { AppScrollArea } from '@/components/app-scroll-area'
import type { WorkspaceFallbackTab } from '@/features/workspace/store/use-workspace-store'
import type { DuoPaneId } from './duo-state'
import { DUO_OPEN_ACTIONS } from './duo-open-actions'
import type { DuoConversationConfiguration } from './duo-conversations'

export const DUO_START_TAB: WorkspaceFallbackTab = {
  id: 'app://duo/start', filePath: 'app://duo/start', kind: 'fallback',
  title: '开始', exists: true, isDirty: false,
}

const startActions = [...DUO_OPEN_ACTIONS].reverse()

export function DuoStartPage({ pane, configuration }: { pane: DuoPaneId; configuration: DuoConversationConfiguration }) {
  return <AppScrollArea className='duo-start-page' contentClassName='duo-start-page-content'>
    <section className='duo-start-page-actions' aria-label='打开内容'>
      {startActions.map(({ id, label, Icon, open }) => (
        <AppButton key={id} variant='ghost' className='duo-start-page-action' onClick={() => open(pane, configuration.selectedProject, configuration.onChooseProject)}>
          <Icon aria-hidden='true' />
          <span>{id === 'conversation' && !configuration.selectedProject ? '选择项目以开始对话' : label}</span>
        </AppButton>
      ))}
    </section>
  </AppScrollArea>
}
