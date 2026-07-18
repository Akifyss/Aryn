import type { ScopedThreadRef } from './contracts'

export function parseScopedThreadKey(value: string): ScopedThreadRef | null {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) return null
  return {
    provider: value.slice(0, separator),
    threadId: value.slice(separator + 1),
  }
}
