import type { ReactNode } from 'react'
import { FolderLine, GitBranchLine } from '@mingcute/react'
import {
  SegmentedTabPanel,
  SegmentedTabs,
} from '@/components/ui/segmented-tabs/segmented-tabs'
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
    <SegmentedTabs<WorkspaceSidebarTab>
      ariaLabel='工作区面板'
      className='sidebar-workspace-tabs'
      controlAdjacent={tabListAction ? (
        <div className='sidebar-workspace-tabs-action'>
          {tabListAction}
        </div>
      ) : null}
      controlContainerClassName='sidebar-workspace-tabs-list-container'
      fill
      options={[
        {
          icon: <FolderLine aria-hidden='true' />,
          label: '文件',
          value: 'file',
        },
        {
          icon: <GitBranchLine aria-hidden='true' />,
          label: '更改',
          value: 'git',
        },
      ]}
      value={activeTab}
      onValueChange={onActiveTabChange}
    >
      <SegmentedTabPanel value='file' className='sidebar-workspace-tab-panel'>
        {filePanel}
      </SegmentedTabPanel>
      <SegmentedTabPanel value='git' className='sidebar-workspace-tab-panel'>
        {gitPanel}
      </SegmentedTabPanel>
    </SegmentedTabs>
  )
}
