export type WorkspaceRefreshRequest = {
  gitSilent?: boolean
  refreshGit?: boolean
  refreshTree?: boolean
  rootPath: string
}

export type WorkspaceRefreshScheduleMode = 'debounced' | 'immediate'

type PendingWorkspaceRefreshRequest = Required<WorkspaceRefreshRequest> & {
  rejecters: Array<(reason?: unknown) => void>
  resolvers: Array<() => void>
}

type WorkspaceRefreshCoordinatorOptions = {
  debounceMs: number
  onFlush: (request: Required<WorkspaceRefreshRequest>) => Promise<void>
}

function createWorkspaceRefreshCanceledError(message: string) {
  const error = new Error(message)
  error.name = 'WorkspaceRefreshCanceledError'
  return error
}

function normalizeWorkspaceRefreshRequest(request: WorkspaceRefreshRequest): Required<WorkspaceRefreshRequest> {
  return {
    gitSilent: request.gitSilent ?? true,
    refreshGit: request.refreshGit ?? false,
    refreshTree: request.refreshTree ?? false,
    rootPath: request.rootPath,
  }
}

export function mergeWorkspaceRefreshRequests(
  currentRequest: WorkspaceRefreshRequest,
  nextRequest: WorkspaceRefreshRequest,
): Required<WorkspaceRefreshRequest> {
  const current = normalizeWorkspaceRefreshRequest(currentRequest)
  const next = normalizeWorkspaceRefreshRequest(nextRequest)

  if (current.rootPath !== next.rootPath) {
    return next
  }

  return {
    gitSilent: current.gitSilent && next.gitSilent,
    refreshGit: current.refreshGit || next.refreshGit,
    refreshTree: current.refreshTree || next.refreshTree,
    rootPath: next.rootPath,
  }
}

export function createWorkspaceRefreshCoordinator(options: WorkspaceRefreshCoordinatorOptions) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let isRunning = false
  let pendingRequest: PendingWorkspaceRefreshRequest | null = null

  const clearDebounceTimer = () => {
    if (!debounceTimer) {
      return
    }

    clearTimeout(debounceTimer)
    debounceTimer = null
  }

  const rejectPendingRequest = (request: PendingWorkspaceRefreshRequest | null, reason: unknown) => {
    if (!request) {
      return
    }

    request.rejecters.forEach((reject) => reject(reason))
  }

  const drainPendingRequests = async () => {
    if (isRunning) {
      return
    }

    clearDebounceTimer()
    isRunning = true

    try {
      while (pendingRequest) {
        const request = pendingRequest
        pendingRequest = null

        try {
          const flushRequest = {
            gitSilent: request.gitSilent,
            refreshGit: request.refreshGit,
            refreshTree: request.refreshTree,
            rootPath: request.rootPath,
          }
          await options.onFlush(flushRequest)
          request.resolvers.forEach((resolve) => resolve())
        } catch (error) {
          request.rejecters.forEach((reject) => reject(error))
        }
      }
    } finally {
      isRunning = false
    }
  }

  const scheduleDrain = (mode: WorkspaceRefreshScheduleMode) => {
    clearDebounceTimer()

    if (mode === 'immediate') {
      void drainPendingRequests()
      return
    }

    debounceTimer = setTimeout(() => {
      void drainPendingRequests()
    }, options.debounceMs)
  }

  return {
    dispose() {
      clearDebounceTimer()

      if (pendingRequest) {
        rejectPendingRequest(pendingRequest, createWorkspaceRefreshCanceledError('Workspace refresh coordinator disposed.'))
        pendingRequest = null
      }
    },
    request(request: WorkspaceRefreshRequest, mode: WorkspaceRefreshScheduleMode = 'immediate') {
      const normalizedRequest = normalizeWorkspaceRefreshRequest(request)

      return new Promise<void>((resolve, reject) => {
        if (!pendingRequest) {
          pendingRequest = {
            ...normalizedRequest,
            rejecters: [reject],
            resolvers: [resolve],
          }
        } else if (pendingRequest.rootPath !== normalizedRequest.rootPath) {
          rejectPendingRequest(
            pendingRequest,
            createWorkspaceRefreshCanceledError('Workspace refresh request superseded by another workspace.'),
          )
          pendingRequest = {
            ...normalizedRequest,
            rejecters: [reject],
            resolvers: [resolve],
          }
        } else {
          const mergedRequest = mergeWorkspaceRefreshRequests(pendingRequest, normalizedRequest)
          pendingRequest = {
            ...mergedRequest,
            rejecters: [...pendingRequest.rejecters, reject],
            resolvers: [...pendingRequest.resolvers, resolve],
          }
        }

        scheduleDrain(mode)
      })
    },
  }
}
