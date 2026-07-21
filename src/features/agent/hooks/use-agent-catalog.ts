import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_AGENT_ID,
  isAgentId,
  type AgentAvailability,
  type AgentId,
} from '@/features/agent/agent-definition'

type AgentAvailabilityFailure = {
  guidance: string
  reason: string
}

type UseAgentCatalogOptions = {
  onCatalogRefreshed: () => void
}

type UseAgentCatalogResult = {
  agentCatalog: AgentAvailability[]
  agentCatalogRefreshError: string | null
  agentCatalogRefreshRevision: number
  markAgentUnavailable: (agentId: AgentId, reason: string, guidance?: string) => void
  refreshAgentCatalog: () => Promise<void>
  selectedAgentIdValue: AgentId
  setSelectedAgentIdValue: Dispatch<SetStateAction<AgentId>>
}

function resolveAvailableAgentId(catalog: readonly AgentAvailability[], agentId: AgentId) {
  return catalog.some((item) => item.definition.id === agentId && item.available)
    ? agentId
    : DEFAULT_AGENT_ID
}

export function useAgentCatalog({
  onCatalogRefreshed,
}: UseAgentCatalogOptions): UseAgentCatalogResult {
  const [agentCatalog, setAgentCatalog] = useState<AgentAvailability[]>([])
  const [agentAvailabilityFailures, setAgentAvailabilityFailures] = useState<
    Partial<Record<AgentId, AgentAvailabilityFailure>>
  >({})
  const [agentCatalogRefreshError, setAgentCatalogRefreshError] = useState<string | null>(null)
  const [agentCatalogRefreshRevision, setAgentCatalogRefreshRevision] = useState(0)
  const [selectedAgentIdValue, setSelectedAgentIdValue] = useState<AgentId>(DEFAULT_AGENT_ID)
  const catalogRequestIdRef = useRef(0)
  const catalogRefreshRef = useRef<Promise<void> | null>(null)
  const isMountedRef = useRef(false)

  const resolvedAgentCatalog = useMemo(() => agentCatalog.map((availability) => {
    const failure = agentAvailabilityFailures[availability.definition.id]
    return failure
      ? { ...availability, available: false, ...failure }
      : availability
  }), [agentAvailabilityFailures, agentCatalog])

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      catalogRequestIdRef.current += 1
    }
  }, [])

  const refreshAgentCatalog = useCallback(() => {
    if (catalogRefreshRef.current) return catalogRefreshRef.current

    const requestId = catalogRequestIdRef.current + 1
    catalogRequestIdRef.current = requestId
    setAgentCatalogRefreshError(null)

    const refresh = window.appApi.getAgentCatalog({ force: true })
      .then((catalog) => {
        if (!isMountedRef.current || catalogRequestIdRef.current !== requestId) return

        onCatalogRefreshed()
        setAgentCatalog(catalog)
        setAgentAvailabilityFailures({})
        setAgentCatalogRefreshRevision((revision) => revision + 1)
        setSelectedAgentIdValue((currentAgentId) => (
          resolveAvailableAgentId(catalog, currentAgentId)
        ))
      })
      .catch((error) => {
        if (!isMountedRef.current || catalogRequestIdRef.current !== requestId) return
        setAgentCatalogRefreshError(error instanceof Error ? error.message : '无法更新 Agent 可用性。')
      })

    catalogRefreshRef.current = refresh
    void refresh.then(() => {
      if (catalogRefreshRef.current === refresh) {
        catalogRefreshRef.current = null
      }
    })
    return refresh
  }, [onCatalogRefreshed])

  const markAgentUnavailable = useCallback((
    agentId: AgentId,
    reason: string,
    guidance = '完成该 Agent 的登录、模型或配置后，重新打开 Agent 菜单。',
  ) => {
    if (agentId === DEFAULT_AGENT_ID) return
    setAgentAvailabilityFailures((current) => ({
      ...current,
      [agentId]: { guidance, reason },
    }))
  }, [])

  useEffect(() => {
    let cancelled = false
    const requestId = catalogRequestIdRef.current + 1
    catalogRequestIdRef.current = requestId

    try {
      const storedAgentId = window.localStorage.getItem('aryn:last-new-conversation-agent')
      if (isAgentId(storedAgentId)) {
        setSelectedAgentIdValue(storedAgentId)
      }
    } catch {
      // The default remains usable when localStorage is unavailable.
    }

    void window.appApi.getAgentCatalog()
      .then((catalog) => {
        if (cancelled || catalogRequestIdRef.current !== requestId) return

        setAgentCatalog(catalog)
        setSelectedAgentIdValue((currentAgentId) => (
          resolveAvailableAgentId(catalog, currentAgentId)
        ))
      })
      .catch((error) => {
        // Built-in PI remains available even if external CLI discovery fails.
        if (!cancelled && catalogRequestIdRef.current === requestId) {
          setAgentCatalogRefreshError(error instanceof Error ? error.message : '无法检测外部 Agent。')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  return {
    agentCatalog: resolvedAgentCatalog,
    agentCatalogRefreshError,
    agentCatalogRefreshRevision,
    markAgentUnavailable,
    refreshAgentCatalog,
    selectedAgentIdValue,
    setSelectedAgentIdValue,
  }
}
