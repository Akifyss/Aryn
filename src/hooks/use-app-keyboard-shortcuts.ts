import { useEffect, useRef } from 'react'

type AppKeyboardShortcutOptions = {
  activeTabId: string | null
  closeActiveTab: (tabId: string) => void | Promise<unknown>
  cycleTabs: (direction: 1 | -1) => void
  isShortcutBlockingLayerOpen: boolean
  onSaveActiveTab: () => void | Promise<unknown>
  onStartContextualConversation: () => void | Promise<unknown>
  onToggleCommandPalette: () => void
  platform: NodeJS.Platform
}

type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'preventDefault' | 'shiftKey'
>

export function handleAppKeyboardShortcut(
  event: KeyboardShortcutEvent,
  options: AppKeyboardShortcutOptions,
) {
  const key = event.key.toLowerCase()
  const platformModifier = options.platform === 'darwin' ? event.metaKey : event.ctrlKey
  const standardModifier = event.ctrlKey || event.metaKey

  if (
    !options.isShortcutBlockingLayerOpen
    && event.ctrlKey
    && event.altKey
    && key === 'n'
  ) {
    event.preventDefault()
    void options.onStartContextualConversation()
    return true
  }

  if (platformModifier && key === 'k') {
    event.preventDefault()
    options.onToggleCommandPalette()
    return true
  }

  if (standardModifier && key === 's') {
    event.preventDefault()
    void options.onSaveActiveTab()
    return true
  }

  if (standardModifier && key === 'w') {
    event.preventDefault()
    if (options.activeTabId) {
      void options.closeActiveTab(options.activeTabId)
    }
    return true
  }

  if (standardModifier && key === 'tab') {
    event.preventDefault()
    options.cycleTabs(event.shiftKey ? -1 : 1)
    return true
  }

  if (standardModifier && key === 'pagedown') {
    event.preventDefault()
    options.cycleTabs(1)
    return true
  }

  if (standardModifier && key === 'pageup') {
    event.preventDefault()
    options.cycleTabs(-1)
    return true
  }

  return false
}

export function useAppKeyboardShortcuts(options: AppKeyboardShortcutOptions) {
  const optionsRef = useRef(options)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      handleAppKeyboardShortcut(event, optionsRef.current)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
