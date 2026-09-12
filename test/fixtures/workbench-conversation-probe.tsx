import { useId, useLayoutEffect, useRef } from 'react'
import { useAgentContext } from '../../src/features/agent/components/agent-sidebar/agent-sidebar-context'

// Observe the real provider, without replacing its state or lifecycle hooks.
export function Probe() {
  const id = useId()
  const context = useAgentContext()
  const latest = useRef(context)
  latest.current = context
  useLayoutEffect(() => {
    const app = window as any
    app.calls.mounts++
    app.probes.set(id, latest)
    return () => { app.calls.unmounts++; app.probes.delete(id) }
  }, [id])
  return <span hidden data-probe-id={id} />
}
