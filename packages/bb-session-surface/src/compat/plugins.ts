import type { ComponentType } from 'react'
import type { ThreadChatMessageReference } from './plugin-sdk'

export const PLUGIN_MENTION_TRIGGER_VALUES: readonly string[] = []

export type PluginMessageActionSlot = {
  component?: ComponentType<Record<string, unknown>>
  generation: number
  icon: string | null
  id: string
  pluginId: string
  title: string
}

export type PluginMessageDirectiveSlot = {
  component: ComponentType<Record<string, unknown>>
  generation: number
  id: string
  pluginId: string
}

export const EMPTY_PLUGIN_SLOT_SNAPSHOT = {
  composerCustomizations: [] as never[],
  fileOpeners: [] as never[],
  homepageSections: [] as never[],
  messageActions: [] as PluginMessageActionSlot[],
  messageDirectives: [] as PluginMessageDirectiveSlot[],
  navPanels: [] as never[],
  pendingInteractions: [] as never[],
  settingsSections: [] as never[],
  sidebarFooterActions: [] as never[],
  threadPanelActions: [] as never[],
}

export function getPluginSlotSnapshot() {
  return EMPTY_PLUGIN_SLOT_SNAPSHOT
}

export function subscribePluginSlots() {
  return () => undefined
}

export async function runPluginMessageAction(_args: {
  slot: PluginMessageActionSlot
  threadId: string
  message: ThreadChatMessageReference
  selectedText?: string
  openThreadPanel?: unknown
}): Promise<void> {
  // Aryn's embedded bb surface deliberately has no bb plugin registry.
}

export function isPluginSideChatSenderThread(_metadata: unknown): boolean {
  return false
}

export type PluginCompactBranding = {
  compactIconUrl: string | null
  icon: string | null
}

export function usePluginCompactBranding(_pluginId: string): PluginCompactBranding | null {
  return null
}
