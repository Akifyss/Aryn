import { createElement } from 'lucide'

const COMPACT_ICON_STYLE = 'width:var(--icon-size-md);height:var(--icon-size-md)'

export function createCompactMeoIcon(
  iconNode: Parameters<typeof createElement>[0],
) {
  return createElement(iconNode, {
    'aria-hidden': 'true',
    style: COMPACT_ICON_STYLE,
  })
}
