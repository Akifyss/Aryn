import { useSyncExternalStore } from 'react'

type UiState = {
  threadChangedFilesExpandedById: Record<string, Record<string, boolean>>
  setThreadChangedFilesExpanded: (routeThreadKey: string, turnId: string, expanded: boolean) => void
}

const listeners = new Set<() => void>()
let expandedByThread: UiState['threadChangedFilesExpandedById'] = {}

function setThreadChangedFilesExpanded(routeThreadKey: string, turnId: string, expanded: boolean) {
  if (expandedByThread[routeThreadKey]?.[turnId] === expanded) return

  expandedByThread = {
    ...expandedByThread,
    [routeThreadKey]: {
      ...expandedByThread[routeThreadKey],
      [turnId]: expanded,
    },
  }
  state = {
    ...state,
    threadChangedFilesExpandedById: expandedByThread,
  }
  for (const listener of listeners) listener()
}

let state: UiState = {
  threadChangedFilesExpandedById: expandedByThread,
  setThreadChangedFilesExpanded,
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function useUiStateStore<Result>(selector: (state: UiState) => Result): Result {
  return selector(useSyncExternalStore(subscribe, getSnapshot, getSnapshot))
}
