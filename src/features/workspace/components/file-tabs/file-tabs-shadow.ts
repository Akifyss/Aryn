export type FileTabsShadowLayer = {
  blurRadius: number
  color: string
  offsetX: number
  offsetY: number
  spreadRadius: number
}

function splitCssList(value: string) {
  const items: string[] = []
  let currentItem = ''
  let parenthesisDepth = 0

  for (const character of value) {
    if (character === '(') {
      parenthesisDepth += 1
    } else if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1)
    }

    if (character === ',' && parenthesisDepth === 0) {
      items.push(currentItem.trim())
      currentItem = ''
      continue
    }

    currentItem += character
  }

  if (currentItem.trim()) {
    items.push(currentItem.trim())
  }

  return items
}

function parseShadowLayer(value: string): FileTabsShadowLayer | null {
  if (!value || /\binset\b/i.test(value)) {
    return null
  }

  const functionalColor = value.match(/(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/i)?.[0]
  const hexColor = value.match(/#[\da-f]{3,8}\b/i)?.[0]
  const color = functionalColor ?? hexColor ?? 'currentcolor'
  const lengths = value
    .replace(color, '')
    .match(/-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?px|(?<![\w.-])0(?![\w.-])/gi)
    ?.map((length) => Number.parseFloat(length))

  if (!lengths || lengths.length < 2 || lengths.some((length) => !Number.isFinite(length))) {
    return null
  }

  return {
    blurRadius: Math.max(0, lengths[2] ?? 0),
    color,
    offsetX: lengths[0],
    offsetY: lengths[1],
    spreadRadius: lengths[3] ?? 0,
  }
}

export function parseComputedBoxShadow(value: string) {
  if (!value || value.trim().toLowerCase() === 'none') {
    return []
  }

  return splitCssList(value)
    .map(parseShadowLayer)
    .filter((layer): layer is FileTabsShadowLayer => layer !== null)
}

export function getFileTabsShadowFilterPadding(layers: FileTabsShadowLayer[]) {
  return layers.reduce(
    (padding, layer) => {
      const blurExtent = layer.blurRadius * 1.5
      const spreadExtent = Math.abs(layer.spreadRadius)

      return {
        x: Math.max(padding.x, Math.ceil(Math.abs(layer.offsetX) + blurExtent + spreadExtent)),
        y: Math.max(padding.y, Math.ceil(Math.abs(layer.offsetY) + blurExtent + spreadExtent)),
      }
    },
    { x: 0, y: 0 },
  )
}
