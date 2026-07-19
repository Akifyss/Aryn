import { useEffect, useRef } from 'react'
import {
  handleWorkspaceChangeEvent,
  type WorkspaceChangeHandlerOptions,
} from '@/features/workspace/lib/workspace-change-handler'

type WorkspaceChangeSubscriptionOptions = Omit<WorkspaceChangeHandlerOptions, 'isEventCurrent'>

export function useWorkspaceChangeSubscription(options: WorkspaceChangeSubscriptionOptions) {
  const nextEventIdRef = useRef(0)
  // Only the newest in-flight event for a workspace path may update tab state.
  const latestEventIdsRef = useRef(new Map<string, number>())

  useEffect(() => {
    const unsubscribe = window.appApi.onWorkspaceChanged((event) => {
      const eventKey = `${event.rootPath}\0${event.path}`
      const eventId = nextEventIdRef.current + 1
      nextEventIdRef.current = eventId
      latestEventIdsRef.current.set(eventKey, eventId)

      void handleWorkspaceChangeEvent(event, {
        ...options,
        isEventCurrent: () => latestEventIdsRef.current.get(eventKey) === eventId,
      })
        .catch((error: unknown) => {
          console.error('[workspace] Failed to handle a workspace change event.', error)
        })
        .finally(() => {
          if (latestEventIdsRef.current.get(eventKey) === eventId) {
            latestEventIdsRef.current.delete(eventKey)
          }
        })
    })

    return () => {
      unsubscribe()
      latestEventIdsRef.current.clear()
    }
  }, [
    options.consumeInternalWorkspaceSave,
    options.currentPath,
    options.requestWorkspaceRefresh,
    options.setStatusMessage,
  ])
}
