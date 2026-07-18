export const CHAT_LIST_ANCHOR_OFFSET = 16

export function resolveChatListAnchoredEndSpace<Item, AnchorId>(
  items: ReadonlyArray<Item>,
  anchorId: AnchorId | null,
  getAnchorId: (item: Item) => AnchorId | null,
  options: { readonly anchorOffset?: number } = {},
) {
  if (anchorId === null) return undefined
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && getAnchorId(item) === anchorId) {
      return {
        anchorIndex: index,
        anchorOffset: options.anchorOffset ?? CHAT_LIST_ANCHOR_OFFSET,
      }
    }
  }
  return undefined
}
