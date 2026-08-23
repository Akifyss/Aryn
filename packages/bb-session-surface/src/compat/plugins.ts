import { atom } from 'jotai'
import type { ComponentType } from 'react'
import type {
  ExperimentalDiffFullFileContents,
  SourceCodeLineRange,
  ThreadChatMessageReference,
} from './plugin-sdk'

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

export type PluginDiffRendererSlot = {
  component: ComponentType<{
    experimental_Original: ComponentType
    experimental_fullFileContents: ExperimentalDiffFullFileContents | null
    overflow: 'scroll' | 'wrap'
    patch: string
    path: string
    showLineNumbers: boolean
    view: 'unified' | 'split'
  }>
  generation: number
  id: string
  pluginId: string
}

export type PluginSourceCodeRendererSlot = {
  component: ComponentType<{
    content: string
    experimental_Original: ComponentType
    highlightedLines: SourceCodeLineRange | null
    overflow: 'scroll' | 'wrap'
    path: string
  }>
  generation: number
  id: string
  pluginId: string
}

export type ResolvedReplacement<Registration> =
  | { kind: 'owner' }
  | { kind: 'plugin'; registration: Registration }

export type ResolvedMessageDirective =
  | { status: 'ok'; slot: PluginMessageDirectiveSlot }
  | { status: 'collision'; pluginIds: readonly string[] }

export const EMPTY_PLUGIN_SLOT_SNAPSHOT = {
  composerCustomizations: [] as never[],
  fileOpeners: [] as never[],
  homepageSections: [] as never[],
  messageActions: [] as PluginMessageActionSlot[],
  messageDirectives: [] as PluginMessageDirectiveSlot[],
  diffRenderers: [] as PluginDiffRendererSlot[],
  sourceCodeRenderers: [] as PluginSourceCodeRendererSlot[],
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

export function usePluginSlots() {
  return EMPTY_PLUGIN_SLOT_SNAPSHOT
}

export function usePluginCss(_pluginId: string) {
  // Aryn's embedded surface has no bb plugin stylesheet registry.
}

export function createReplacementPreferenceAtom(_storageKey: string) {
  return atom('__automatic__')
}

export function resolvePreferredReplacement<Registration>(
  _registrations: readonly Registration[],
  _preference?: string,
): ResolvedReplacement<Registration> {
  return { kind: 'owner' }
}

export function resolveMessageDirectiveRegistry(
  registrations: readonly PluginMessageDirectiveSlot[],
): ReadonlyMap<string, ResolvedMessageDirective> {
  const claimants = new Map<string, PluginMessageDirectiveSlot[]>()
  for (const registration of registrations) {
    const existing = claimants.get(registration.id)
    if (existing) existing.push(registration)
    else claimants.set(registration.id, [registration])
  }
  const resolved = new Map<string, ResolvedMessageDirective>()
  for (const [id, slots] of claimants) {
    if (slots.length === 1 && slots[0]) resolved.set(id, { status: 'ok', slot: slots[0] })
    else resolved.set(id, {
      status: 'collision',
      pluginIds: [...new Set(slots.map((slot) => slot.pluginId))].sort(),
    })
  }
  return resolved
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
