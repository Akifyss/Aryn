export type SenderThreadMetadata = {
  projectId: string
  title: string | null
  originKind: import('@bb/domain').ThreadOriginKind | null
  originPluginId: string | null
  visibility: import('@bb/domain').ThreadVisibility | null
}
const EMPTY_METADATA = new Map<string, SenderThreadMetadata>()

export function useSenderThreadMetadataById(): ReadonlyMap<string, SenderThreadMetadata> {
  return EMPTY_METADATA
}
