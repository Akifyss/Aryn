type SessionParent = { id: string; parentID?: string }

// Retains OpenCode packages/app/src/utils/session-route.ts semantics while
// adding a fail-fast cycle guard at the Aryn bridge boundary.
export async function rootSession<T extends SessionParent>(session: T, get: (sessionID: string) => Promise<T>) {
  const seen = new Set([session.id])
  let current = session
  while (current.parentID) {
    if (seen.has(current.parentID)) throw new Error(`Session parent cycle: ${current.parentID}`)
    seen.add(current.parentID)
    current = await get(current.parentID)
  }
  return current
}
