type AgentKeyboardCompositionEvent = {
  isComposing?: boolean
  keyCode?: number
}

function isAgentKeyboardCompositionEvent(event: {
  isComposing?: boolean
  keyCode?: number
  nativeEvent?: AgentKeyboardCompositionEvent
}) {
  return Boolean(
    event.isComposing
    || event.keyCode === 229
    || event.nativeEvent?.isComposing
    || event.nativeEvent?.keyCode === 229,
  )
}

export {
  isAgentKeyboardCompositionEvent,
}
