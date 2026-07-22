type ProjectMenuSearchKeyDownEvent = {
  key: string
  nativeEvent?: {
    isComposing?: boolean
    keyCode?: number
  }
  stopPropagation: () => void
}

const TEXT_EDITING_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'Backspace',
  'Delete',
  'End',
  'Home',
])

export function handleProjectMenuSearchKeyDown(event: ProjectMenuSearchKeyDownEvent) {
  const isComposing = event.nativeEvent?.isComposing === true
    || event.nativeEvent?.keyCode === 229

  // Base UI's menu typeahead prevents character input by default. Keep text
  // editing inside the field while preserving menu navigation and selection keys.
  if (isComposing || event.key.length === 1 || TEXT_EDITING_KEYS.has(event.key)) {
    event.stopPropagation()
  }
}
