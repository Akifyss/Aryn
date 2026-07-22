import { Icon } from '@iconify/react'
import { Chat3Line, FolderLine, LayoutLeftLine } from '@mingcute/react'
import { AppTooltipButton } from '@/components/app-tooltip'
import { SegmentedIconTabs } from '@/components/ui/segmented-icon-tabs/segmented-icon-tabs'
import type { AppLayoutPreference } from '@/hooks/use-settings-store'
import './styles.css'

type AppLayoutModeSwitchProps = {
  isEditorDisabled: boolean
  value: AppLayoutPreference
  onValueChange: (value: AppLayoutPreference) => void
}

export function AppLayoutModeSwitch({
  isEditorDisabled,
  value,
  onValueChange,
}: AppLayoutModeSwitchProps) {
  return (
    <SegmentedIconTabs<AppLayoutPreference>
      ariaLabel='Layout mode'
      className='app-layout-mode-switch'
      value={value}
      options={[
        {
          ariaLabel: 'Agent mode',
          icon: <Chat3Line size={16} aria-hidden='true' />,
          tooltip: 'Agent 模式',
          value: 'agent',
        },
        {
          ariaLabel: isEditorDisabled ? 'Editor mode, select a workspace first' : 'Editor mode',
          disabled: isEditorDisabled,
          icon: <FolderLine size={16} aria-hidden='true' />,
          tooltip: isEditorDisabled ? '先选择工作目录' : '编辑器模式',
          value: 'editor',
        },
      ]}
      onValueChange={(nextValue) => {
        if (nextValue === 'agent' || (nextValue === 'editor' && !isEditorDisabled)) {
          onValueChange(nextValue)
        }
      }}
    />
  )
}

type AppChromeSearchButtonProps = {
  onClick: () => void
}

export function AppChromeSearchButton({ onClick }: AppChromeSearchButtonProps) {
  return (
    <AppTooltipButton
      type='button'
      className='panel-toggle-button left-chrome-search-button'
      aria-label='Open search'
      tooltip='搜索'
      preventFocusOnPress
      onClick={onClick}
    >
      <Icon icon='lucide:search' width={16} height={16} aria-hidden='true' />
    </AppTooltipButton>
  )
}

type AppChromeSidebarToggleButtonProps = {
  isDrawer: boolean
  isDrawerOpen: boolean
  isSidebarVisible: boolean
  onClick: () => void
}

export function AppChromeSidebarToggleButton({
  isDrawer,
  isDrawerOpen,
  isSidebarVisible,
  onClick,
}: AppChromeSidebarToggleButtonProps) {
  const ariaLabel = isDrawer
    ? (isDrawerOpen ? 'Close workspace panel' : 'Open workspace panel')
    : (isSidebarVisible ? 'Collapse sidebar' : 'Expand sidebar')
  const tooltip = isDrawer
    ? (isDrawerOpen ? '关闭抽屉' : '打开抽屉')
    : (isSidebarVisible ? '收起侧边栏' : '展开侧边栏')

  return (
    <AppTooltipButton
      type='button'
      className='panel-toggle-button'
      aria-label={ariaLabel}
      tooltip={tooltip}
      preventFocusOnPress
      onClick={onClick}
    >
      <span className='panel-toggle-icon' aria-hidden='true'>
        <LayoutLeftLine size={16} />
      </span>
    </AppTooltipButton>
  )
}
