import { SearchLine } from '@mingcute/react'
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
