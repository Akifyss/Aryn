export const PPTX_CONTENT_TYPE_BY_EXTENSION = {
  potm: 'application/vnd.ms-powerpoint.template.macroEnabled.12',
  potx: 'application/vnd.openxmlformats-officedocument.presentationml.template',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
} as const

export const PPTX_FILE_EXTENSIONS = Object.freeze(
  Object.keys(PPTX_CONTENT_TYPE_BY_EXTENSION) as Array<keyof typeof PPTX_CONTENT_TYPE_BY_EXTENSION>,
)

export const PPTX_CONTENT_TYPES = Object.freeze(
  Object.values(PPTX_CONTENT_TYPE_BY_EXTENSION),
)

export const PPTX_MIME_TYPE = PPTX_CONTENT_TYPE_BY_EXTENSION.pptx

export const PPTX_FILE_ACCEPT = [
  ...PPTX_FILE_EXTENSIONS.map((extension) => `.${extension}`),
  ...PPTX_CONTENT_TYPES,
].join(',')

const PPTX_CONTENT_TYPE_SET = new Set<string>(
  PPTX_CONTENT_TYPES.map((contentType) => contentType.toLowerCase()),
)
const PPTX_FILE_NAME_PATTERN = new RegExp(`\\.(${PPTX_FILE_EXTENSIONS.join('|')})$`, 'i')

function normalizeContentType(contentType: string) {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

export function isPptxContentType(contentType: string | null | undefined) {
  return Boolean(contentType && PPTX_CONTENT_TYPE_SET.has(normalizeContentType(contentType)))
}

export function isPptxFileName(fileName: string) {
  return PPTX_FILE_NAME_PATTERN.test(fileName)
}

export function isPptxFile(file: {
  contentType?: string | null
  name?: string | null
  path: string
}) {
  return isPptxContentType(file.contentType) || isPptxFileName(file.name ?? file.path)
}
