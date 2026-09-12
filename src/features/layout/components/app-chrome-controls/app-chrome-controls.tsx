import { LayoutLeftLine, SearchLine } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'

type AppChromeSearchButtonProps = {
  onClick: () => void
}

export function AppChromeSearchButton({ onClick }: AppChromeSearchButtonProps) {
  return (
    <AppIconButton
      type='button'
      data-window-chrome-button='true'
      aria-label='Open search'
      tooltip='搜索'
      preventFocusOnPress
      onClick={onClick}
    >
      <SearchLine aria-hidden='true' />
    </AppIconButton>
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
    <AppIconButton
      type='button'
      data-window-chrome-button='true'
      aria-label={ariaLabel}
      tooltip={tooltip}
      preventFocusOnPress
      onClick={onClick}
    >
      <span className='panel-toggle-icon' aria-hidden='true'>
        <LayoutLeftLine />
      </span>
    </AppIconButton>
  )
}
