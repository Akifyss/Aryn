import { AddLine } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import { AppMenu as Menu } from '@/components/app-menu'
import type { WorkbenchPaneId } from './workbench-state'
import { WORKBENCH_OPEN_ACTIONS } from './workbench-open-actions'
import type { WorkbenchConversationConfiguration } from './workbench-conversations'

export function WorkbenchNewTabMenu({ pane, configuration }: { pane: WorkbenchPaneId; configuration: WorkbenchConversationConfiguration }) {
  return <Menu.Root modal={false}>
    <Menu.Trigger render={<AppIconButton />} aria-label={pane === 'left' ? '左侧新建标签页' : '右侧新建标签页'}>
      <AddLine aria-hidden='true' />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner side='bottom' align='start' sideOffset={6}>
        <Menu.Popup>
          {WORKBENCH_OPEN_ACTIONS.map(({ id, label, Icon, open }) => (
            <Menu.Item key={id} icon={<Icon />} label={label} text={label} onClick={() => open(pane, configuration.selectedProject, configuration.onChooseProject)} />
          ))}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
}
