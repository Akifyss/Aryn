import { createContext, useContext, type ComponentType, type ReactNode } from 'react'
import type {
  PluginMessageDirectiveMessage,
  PluginMessageDirectiveProps,
} from './plugin-sdk'
import type { PluginMessageDirectiveSlot } from './plugins'

export type MarkdownMessageDirectiveOpenThreadPanel = (
  options: Record<string, unknown> & { pluginId: string },
) => boolean

export type MessageDirectiveRegistryEntry =
  | { status: 'ok'; slot: PluginMessageDirectiveSlot }
  | { status: 'collision'; pluginIds: readonly string[] }

export type MessageDirectiveRegistry = ReadonlyMap<string, MessageDirectiveRegistryEntry>

export type MountedMessageDirective = {
  attributes: Readonly<Record<string, string>>
  index: number
  slot: PluginMessageDirectiveSlot
  source: string
}

export interface MarkdownMessageDirectives {
  registry: MessageDirectiveRegistry
  message: PluginMessageDirectiveMessage
  openWorkspaceFile: PluginMessageDirectiveProps['openWorkspaceFile']
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | null
}

const RegistryContext = createContext<MessageDirectiveRegistry>(new Map())

export function buildMessageDirectiveRegistry(
  _slots: readonly PluginMessageDirectiveSlot[],
  _options?: { warn?: (message: string) => void },
): MessageDirectiveRegistry {
  return new Map()
}

export function MessageDirectiveRegistryProvider({
  children,
  registry,
}: {
  children: ReactNode
  registry: MessageDirectiveRegistry
}) {
  return <RegistryContext.Provider value={registry}>{children}</RegistryContext.Provider>
}

export function useMessageDirectiveRegistry(): MessageDirectiveRegistry {
  return useContext(RegistryContext)
}

export function remarkMessageDirectives(_args: {
  mounts: MountedMessageDirective[]
  registry: MessageDirectiveRegistry
}) {
  return () => undefined
}

export function buildMessageDirectiveComponent(_args: {
  mounts: MountedMessageDirective[]
  message: PluginMessageDirectiveMessage
  openWorkspaceFile: PluginMessageDirectiveProps['openWorkspaceFile']
  openThreadPanel: MarkdownMessageDirectiveOpenThreadPanel | null
}): ComponentType<Record<string, unknown>> {
  return function EmptyMessageDirective() {
    return null
  }
}
