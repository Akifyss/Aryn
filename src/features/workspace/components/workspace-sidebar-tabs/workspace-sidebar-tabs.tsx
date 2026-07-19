import type { ReactNode } from 'react'
import { Tabs } from '@base-ui/react/tabs'
import { FolderLine, GitBranchLine } from '@mingcute/react'
import './styles.css'

export type WorkspaceSidebarTab = 'file' | 'git'

type WorkspaceSidebarTabsProps = {
  activeTab: WorkspaceSidebarTab
  filePanel: ReactNode
  gitPanel: ReactNode
  tabListAction?: ReactNode
  onActiveTabChange: (tab: WorkspaceSidebarTab) => void
}

export function WorkspaceSidebarTabs({
  activeTab,
  filePanel,
  gitPanel,
  tabListAction,
  onActiveTabChange,
}: WorkspaceSidebarTabsProps) {
  return (
    <Tabs.Root
      className='sidebar-workspace-tabs'
      orientation='horizontal'
      value={activeTab}
      onValueChange={(value) => {
        if (value === 'file' || value === 'git') {
          onActiveTabChange(value)
        }
      }}
    >
      <div className='sidebar-workspace-tabs-list-container'>
        <Tabs.List aria-label='工作区面板' className='sidebar-workspace-tabs-list'>
          <Tabs.Tab value='file' className='sidebar-workspace-tab'>
            <FolderLine aria-hidden='true' size={16} className='sidebar-workspace-tab-icon' />
            <span className='sidebar-workspace-tab-label'>文件</span>
          </Tabs.Tab>
          <Tabs.Tab value='git' className='sidebar-workspace-tab'>
            <GitBranchLine aria-hidden='true' size={16} className='sidebar-workspace-tab-icon' />
            <span className='sidebar-workspace-tab-label'>更改</span>
          </Tabs.Tab>
          <Tabs.Indicator className='sidebar-workspace-tab-indicator' />
        </Tabs.List>
        {tabListAction ? (
          <div className='sidebar-workspace-tabs-action'>
            {tabListAction}
          </div>
        ) : null}
      </div>

      <Tabs.Panel value='file' className='sidebar-workspace-tab-panel'>
        {filePanel}
      </Tabs.Panel>
      <Tabs.Panel value='git' className='sidebar-workspace-tab-panel'>
        {gitPanel}
      </Tabs.Panel>
    </Tabs.Root>
  )
}
