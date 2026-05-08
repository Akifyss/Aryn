type OpenFileProfileGlobal = {
  record?: (name: string, details?: unknown) => void
}

declare global {
  interface Window {
    __ARYN_OPEN_FILE_PROFILE__?: OpenFileProfileGlobal
  }
}

function roundDuration(durationMs: number) {
  return Math.round(durationMs * 10) / 10
}

export function recordOpenFileProfile(name: string, details?: Record<string, unknown>) {
  try {
    window.__ARYN_OPEN_FILE_PROFILE__?.record?.(name, details ?? null)
  } catch {
    // Profiling must stay best-effort.
  }
}

export function getOpenFileProfileDuration(startedAt: number) {
  return roundDuration(performance.now() - startedAt)
}
