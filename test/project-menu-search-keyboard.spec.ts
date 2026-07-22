import { describe, expect, it, vi } from 'vitest'
import { handleProjectMenuSearchKeyDown } from '@/features/workspace/components/project-menu/project-menu-search-keyboard'

describe('project menu search keyboard handling', () => {
  it.each(['a', ' ', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])(
    'keeps %s inside the search input instead of forwarding it to the menu',
    (key) => {
      const stopPropagation = vi.fn()

      handleProjectMenuSearchKeyDown({ key, stopPropagation })

      expect(stopPropagation).toHaveBeenCalledOnce()
    },
  )

  it.each(['ArrowUp', 'ArrowDown', 'Enter', 'Escape', 'Tab'])(
    'lets %s reach the menu keyboard handling',
    (key) => {
      const stopPropagation = vi.fn()

      handleProjectMenuSearchKeyDown({ key, stopPropagation })

      expect(stopPropagation).not.toHaveBeenCalled()
    },
  )

  it.each([
    { isComposing: true },
    { keyCode: 229 },
  ])('keeps input method composition inside the search input', (nativeEvent) => {
    const stopPropagation = vi.fn()

    handleProjectMenuSearchKeyDown({ key: 'Enter', nativeEvent, stopPropagation })

    expect(stopPropagation).toHaveBeenCalledOnce()
  })
})
