import type { MenuRootChangeEventDetails } from '@base-ui/react/menu'

export function shouldCloseClickOpenedMenu(details: MenuRootChangeEventDetails) {
  return details.reason === 'outside-press'
    || details.reason === 'escape-key'
    || details.reason === 'item-press'
    || details.reason === 'close-press'
    || details.reason === 'imperative-action'
    || details.reason === 'trigger-press'
}
