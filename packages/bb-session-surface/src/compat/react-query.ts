import { createContext } from 'react'

export type QueryKey = readonly unknown[]

export interface QueryClient {
  getQueryData<TData>(queryKey: QueryKey): TData | undefined
}

// The embedded surface has no bb query cache. Upstream consumers already
// treat a missing QueryClient as an empty cache and fall back to literal ids.
export const QueryClientContext = createContext<QueryClient | undefined>(undefined)
