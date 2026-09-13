/** The selected tab sticks in the native scroller; only its neighbors fade. */
export function updateFileTabOverflow(
  scroller: HTMLElement,
  active: HTMLElement | null | undefined,
  viewport: DOMRect,
) {
  const tabs = [...scroller.querySelectorAll<HTMLElement>('.file-tab')]
  const bounds = tabs.map(tab => tab.getBoundingClientRect())
  const activeIndex = active ? tabs.indexOf(active) : -1
  const activeBounds = bounds[activeIndex]
  const fadeWidth = parseFloat(getComputedStyle(scroller).getPropertyValue('--file-tabs-overflow-fade-width')) || 24
  const range = (left: number, right: number, first: DOMRect | undefined, last: DOMRect | undefined) => {
    const fade = Math.min(fadeWidth, Math.max(0, right - left) / 2)
    return { left, right,
      startFade: first && first.left < left - 0.5 ? fade : 0,
      endFade: last && last.right > right + 0.5 ? fade : 0,
    }
  }
  // One continuous fade for each side of the selection, even when its edge
  // happens to fall between tabs or only a few pixels of a tab remain visible.
  const before = range(viewport.left, Math.min(viewport.right, activeBounds?.left ?? viewport.right),
    bounds[0], bounds[activeIndex < 0 ? bounds.length - 1 : activeIndex - 1])
  const after = range(Math.max(viewport.left, activeBounds?.right ?? viewport.left), viewport.right,
    bounds[activeIndex + 1], bounds[bounds.length - 1])
  // Read every position before writing styles to avoid interleaved layout work.
  const updates = tabs.map((tab, index) => {
    if (tab === active) return { tab, clip: '', mask: '' }
    const rect = bounds[index]
    const { left, right, startFade, endFade } = activeIndex < 0 || index < activeIndex ? before : after
    const start = left - rect.left
    const end = right - rect.left
    if (end <= 0 || start >= rect.width || right <= left) {
      return { tab, clip: 'inset(0 100% 0 0)', mask: '' }
    }
    return { tab,
      clip: start > 0 || end < rect.width ? `inset(0 ${Math.max(0, rect.width - end)}px 0 ${Math.max(0, start)}px)` : '',
      mask: startFade || endFade
        ? `linear-gradient(to right, transparent ${start}px, black ${start + startFade}px, black ${end - endFade}px, transparent ${end}px)`
        : '',
    }
  })
  for (const update of updates) {
    if (update.tab.style.clipPath !== update.clip) update.tab.style.clipPath = update.clip
    if (update.tab.style.maskImage !== update.mask) update.tab.style.maskImage = update.mask
  }
}

// Measure the rail's capacity, not the current content-sized scroller. Otherwise
// a single long tab shrunk by a narrow window cannot grow back on expansion.
export function getFileTabsAvailableWidth(shell: HTMLElement) {
  const style = getComputedStyle(shell)
  const newAction = shell.querySelector('.file-tabs-new-action')?.getBoundingClientRect().width ?? 0
  const actions = shell.querySelector('.file-tabs-actions')?.getBoundingClientRect().width ?? 0
  const spacer = shell.querySelector('.file-tabs-drag-spacer')
  const minSpacerWidth = spacer ? parseFloat(getComputedStyle(spacer).minWidth) || 0 : 0
  return Math.max(0, shell.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    - newAction - actions - minSpacerWidth)
}
