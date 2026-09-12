import type { ReactNode } from 'react'
import { Chat3Line, FolderLine, GitBranchLine } from '@mingcute/react'
import {
  SegmentedTabPanel,
  SegmentedTabs,
} from '@/components/ui/segmented-tabs/segmented-tabs'
import './styles.css'

export type WorkspaceSidebarTab = 'file' | 'git'
export type WorkspaceSidebarTabWithConversations = WorkspaceSidebarTab | 'conversation'

type WorkspaceSidebarTabsProps = {
  filePanel: ReactNode
  gitPanel: ReactNode
  tabListAction?: ReactNode
} & ({
  conversationPanel?: never
  activeTab: WorkspaceSidebarTab
  onActiveTabChange: (tab: WorkspaceSidebarTab) => void
} | {
  conversationPanel: ReactNode
  activeTab: WorkspaceSidebarTabWithConversations
  onActiveTabChange: (tab: WorkspaceSidebarTabWithConversations) => void
})

export function WorkspaceSidebarTabs({
  activeTab,
  filePanel,
  gitPanel,
  conversationPanel,
  tabListAction,
  onActiveTabChange,
}: WorkspaceSidebarTabsProps) {
  return (
    <SegmentedTabs<WorkspaceSidebarTabWithConversations>
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
        ...(conversationPanel !== undefined ? [{ icon: <Chat3Line aria-hidden='true' />, label: '对话', value: 'conversation' as const }] : []),
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
      onValueChange={(tab) => {
        if (tab !== 'conversation') onActiveTabChange(tab)
        else if (conversationPanel !== undefined) (onActiveTabChange as (tab: WorkspaceSidebarTabWithConversations) => void)(tab)
      }}
    >
      {conversationPanel !== undefined ? <SegmentedTabPanel value='conversation' className='sidebar-workspace-tab-panel'>
        {conversationPanel}
      </SegmentedTabPanel> : null}
      <SegmentedTabPanel value='file' className='sidebar-workspace-tab-panel'>
        {filePanel}
      </SegmentedTabPanel>
      <SegmentedTabPanel value='git' className='sidebar-workspace-tab-panel'>
        {gitPanel}
      </SegmentedTabPanel>
    </SegmentedTabs>
  )
}
