import { AddLine } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import { AppMenu as Menu } from '@/components/app-menu'
import type { DuoPaneId } from './duo-state'
import { DUO_OPEN_ACTIONS } from './duo-open-actions'
import type { DuoConversationConfiguration } from './duo-conversations'

export function DuoNewTabMenu({ pane, configuration }: { pane: DuoPaneId; configuration: DuoConversationConfiguration }) {
  return <Menu.Root modal={false}>
    <Menu.Trigger render={<AppIconButton />} aria-label={pane === 'left' ? '左侧新建标签页' : '右侧新建标签页'}>
      <AddLine aria-hidden='true' />
    </Menu.Trigger>
    <Menu.Portal>
      <Menu.Positioner side='bottom' align='start' sideOffset={6}>
        <Menu.Popup>
          {DUO_OPEN_ACTIONS.map(({ id, label, Icon, open }) => (
            <Menu.Item key={id} icon={<Icon />} label={label} text={label} onClick={() => open(pane, configuration.selectedProject, configuration.onChooseProject)} />
          ))}
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>
}
