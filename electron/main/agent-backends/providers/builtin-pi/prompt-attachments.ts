import path from 'node:path'
import {
  formatDimensionNote,
  resizeImage,
} from '@earendil-works/pi-coding-agent'
import type {
  Api,
  ImageContent,
  Model,
  TextContent,
  UserMessage,
} from '@earendil-works/pi-ai'
import type {
  AgentMessageAttachment,
  AgentPromptAttachment,
} from '../../../../../src/features/agent/types'
import { pathExists } from './file-system'

type PreparedPromptAttachments = {
  images: ImageContent[]
  text: string
}

export const AGENT_PROMPT_ATTACHMENT_PREFIX = 'Attachments:'
const MAX_PROMPT_ATTACHMENTS = 12
const MAX_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024

export function asPiMessageText(value: string | Array<TextContent | ImageContent>) {
  if (typeof value === 'string') return value.trim()
  return value
    .map((block) => block.type === 'text' ? block.text : '[Image attachment]')
    .join('\n')
    .trim()
}

function stripDataUrlPrefix(value: string) {
  const trimmedValue = value.trim()
  const dataUrlMatch = trimmedValue.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.*)$/is)
  return dataUrlMatch ? dataUrlMatch[2]?.trim() ?? '' : trimmedValue
}

function getDataUrlMimeType(value: string) {
  return value.trim().match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,/i)?.[1]?.toLowerCase() ?? null
}

function normalizePromptAttachment(value: unknown): AgentPromptAttachment | null {
  if (!value || typeof value !== 'object') return null

  const attachment = value as Partial<AgentPromptAttachment>
  const fileName = typeof attachment.fileName === 'string' ? attachment.fileName.trim() : ''
  const pathValue = typeof attachment.path === 'string' ? attachment.path.trim() : undefined
  const dataValue = typeof attachment.data === 'string' ? attachment.data.trim() : undefined
  if (!fileName && !pathValue) return null

  const mimeType = typeof attachment.mimeType === 'string' && attachment.mimeType.trim()
    ? attachment.mimeType.trim().toLowerCase()
    : dataValue
      ? getDataUrlMimeType(dataValue) ?? undefined
      : undefined
  const kind = attachment.kind === 'image' || mimeType?.startsWith('image/') ? 'image' : 'file'
  const normalizedSize = typeof attachment.size === 'number'
    && Number.isFinite(attachment.size)
    && attachment.size >= 0
    ? attachment.size
    : undefined

  return {
    ...(dataValue ? { data: dataValue } : {}),
    fileName: fileName || path.basename(pathValue ?? 'attachment'),
    kind,
    ...(mimeType ? { mimeType } : {}),
    ...(pathValue ? { path: pathValue } : {}),
    ...(normalizedSize !== undefined ? { size: normalizedSize } : {}),
  }
}

export function normalizePromptAttachments(attachments: unknown): AgentPromptAttachment[] {
  if (!Array.isArray(attachments)) return []
  return attachments
    .map(normalizePromptAttachment)
    .filter((attachment): attachment is AgentPromptAttachment => Boolean(attachment))
    .slice(0, MAX_PROMPT_ATTACHMENTS)
}

function serializeAttachmentReference(attachment: AgentMessageAttachment) {
  const reference = {
    fileName: attachment.fileName,
    kind: attachment.kind,
    ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
    ...(attachment.path ? { path: attachment.path } : {}),
    ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    ...(attachment.status ? { status: attachment.status } : {}),
  }
  return `- ${JSON.stringify(reference)}`
}

function parseAttachmentReferenceLine(line: string): AgentMessageAttachment | null {
  const trimmedLine = line.trim()
  if (!trimmedLine.startsWith('- ')) return null
  const payload = trimmedLine.slice(2).trim()

  if (payload.startsWith('{')) {
    try {
      const parsed = JSON.parse(payload) as Partial<AgentMessageAttachment>
      const fileName = typeof parsed.fileName === 'string' ? parsed.fileName.trim() : ''
      const kind = parsed.kind === 'image' ? 'image' : 'file'
      const mimeType = typeof parsed.mimeType === 'string' ? parsed.mimeType.trim() : ''
      const pathValue = typeof parsed.path === 'string' ? parsed.path.trim() : ''
      const size = typeof parsed.size === 'number' && Number.isFinite(parsed.size) && parsed.size >= 0
        ? parsed.size
        : undefined
      const status = parsed.status === 'sent' || parsed.status === 'omitted' || parsed.status === 'referenced'
        ? parsed.status
        : 'referenced'
      if (!fileName) return null
      return {
        fileName,
        kind,
        ...(mimeType ? { mimeType } : {}),
        ...(pathValue ? { path: pathValue } : {}),
        ...(size !== undefined ? { size } : {}),
        status,
      }
    } catch {
      // Fall back to the legacy human-readable format below.
    }
  }

  const label = payload.split(' (')[0]?.trim()
  const pathMatch = line.match(/path:\s*([^,)]+)/)
  const isImage = /\bimage\b/i.test(line)
  const status = /not sent as image|too large/i.test(line) ? 'omitted' : 'referenced'
  return label
    ? {
        fileName: label,
        kind: isImage ? 'image' : 'file',
        ...(pathMatch?.[1] ? { path: pathMatch[1].trim() } : {}),
        status,
      }
    : null
}

export function appendAttachmentText(prompt: string, attachmentText: string) {
  const trimmedAttachmentText = attachmentText.trim()
  if (!trimmedAttachmentText) return prompt.trim()
  return `${prompt.trim()}\n\n${AGENT_PROMPT_ATTACHMENT_PREFIX}\n${trimmedAttachmentText}`.trim()
}

export async function preparePromptAttachments(
  attachments: AgentPromptAttachment[],
  model: Model<Api>,
): Promise<PreparedPromptAttachments> {
  const images: ImageContent[] = []
  const textLines: string[] = []
  const supportsImages = model.input.includes('image')

  for (const attachment of attachments) {
    if (attachment.kind !== 'image' && !attachment.path) {
      throw new Error(`Attachment "${attachment.fileName}" does not have a readable file path.`)
    }
    if (attachment.path && !(await pathExists(attachment.path))) {
      throw new Error(`Attachment "${attachment.fileName}" does not exist at ${attachment.path}.`)
    }

    const baseMetadata: AgentMessageAttachment = {
      fileName: attachment.fileName,
      kind: attachment.kind,
      ...(attachment.data ? { data: attachment.data } : {}),
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.path ? { path: attachment.path } : {}),
      ...(attachment.size !== undefined ? { size: attachment.size } : {}),
    }

    if (attachment.kind === 'image' && attachment.data) {
      const imageData = stripDataUrlPrefix(attachment.data)
      const mimeType = attachment.mimeType ?? getDataUrlMimeType(attachment.data) ?? 'image/png'
      const encodedSize = Buffer.byteLength(imageData, 'utf-8')
      if (!supportsImages || encodedSize > MAX_IMAGE_ATTACHMENT_BYTES) {
        textLines.push(serializeAttachmentReference({ ...baseMetadata, mimeType, status: 'omitted' }))
        continue
      }

      const resizedImage = await resizeImage({ type: 'image', data: imageData, mimeType })
      const image = resizedImage
        ? { type: 'image' as const, data: resizedImage.data, mimeType: resizedImage.mimeType }
        : { type: 'image' as const, data: imageData, mimeType }
      images.push(image)
      textLines.push(serializeAttachmentReference({
        ...baseMetadata,
        mimeType: image.mimeType,
        status: 'sent',
      }))
      const dimensionNote = resizedImage ? formatDimensionNote(resizedImage) : undefined
      if (dimensionNote) textLines.push(`  ${dimensionNote}`)
      continue
    }

    textLines.push(serializeAttachmentReference({ ...baseMetadata, status: 'referenced' }))
  }

  return { images, text: textLines.join('\n') }
}

export function extractPromptAttachmentsFromMessage(message: UserMessage): AgentMessageAttachment[] {
  const text = asPiMessageText(message.content)
  const attachmentStart = text.indexOf(`\n\n${AGENT_PROMPT_ATTACHMENT_PREFIX}\n`)
  const attachmentSection = attachmentStart >= 0
    ? text.slice(attachmentStart + AGENT_PROMPT_ATTACHMENT_PREFIX.length + 3)
    : text.startsWith(`${AGENT_PROMPT_ATTACHMENT_PREFIX}\n`)
      ? text.slice(AGENT_PROMPT_ATTACHMENT_PREFIX.length + 1)
      : ''
  const contentImages = typeof message.content === 'string'
    ? []
    : message.content.filter((block): block is ImageContent => block.type === 'image')
  let parsedImageIndex = 0
  const textAttachments: AgentMessageAttachment[] = []

  for (const line of attachmentSection.split('\n')) {
    if (!line.trim().startsWith('- ')) continue
    const isJsonReference = line.trim().slice(2).trim().startsWith('{')
    const attachment = parseAttachmentReferenceLine(line)
    if (!attachment) continue
    const shouldConsumeImageBlock = attachment.kind === 'image'
      && (attachment.status === 'sent' || (!isJsonReference && attachment.status !== 'omitted'))
      && Boolean(contentImages[parsedImageIndex])
    if (shouldConsumeImageBlock) {
      const matchedImage = contentImages[parsedImageIndex]
      parsedImageIndex += 1
      textAttachments.push({
        ...attachment,
        data: `data:${matchedImage.mimeType};base64,${matchedImage.data}`,
        mimeType: attachment.mimeType ?? matchedImage.mimeType,
        status: 'sent',
      })
    } else {
      textAttachments.push(attachment)
    }
  }

  if (typeof message.content === 'string') return textAttachments
  const imageAttachments = contentImages.slice(parsedImageIndex).map((block, index): AgentMessageAttachment => ({
    data: `data:${block.mimeType};base64,${block.data}`,
    fileName: `Image ${parsedImageIndex + index + 1}`,
    kind: 'image',
    mimeType: block.mimeType,
    status: 'sent',
  }))
  return [...textAttachments, ...imageAttachments]
}
