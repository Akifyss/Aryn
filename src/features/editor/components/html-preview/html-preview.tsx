import { useMemo } from 'react'
import './styles.css'

const HTML_PREVIEW_IFRAME_SANDBOX = 'allow-scripts'

function escapeHtmlAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

function encodeFileUrlPathSegment(segment: string, index: number, segments: string[]) {
  if (index === 1 && segments[0] === '' && /^[A-Za-z]:$/.test(segment)) {
    return segment
  }

  return encodeURIComponent(segment)
}

function getFileDirectoryHref(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/')
  const directoryPath = normalizedPath.slice(0, normalizedPath.lastIndexOf('/') + 1)
  const prefixedPath = /^[A-Za-z]:\//.test(directoryPath)
    ? `/${directoryPath}`
    : directoryPath
  const fileUrlPath = prefixedPath
    .split('/')
    .map(encodeFileUrlPathSegment)
    .join('/')

  return `file://${fileUrlPath}`
}

function injectBaseHref(html: string, baseHref: string) {
  if (/<base[\s>]/i.test(html)) {
    return html
  }

  const baseTag = `<base href="${escapeHtmlAttribute(baseHref)}">`

  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${baseTag}</head>`)
  }

  return `<!doctype html><html><head>${baseTag}</head><body>${html}</body></html>`
}

export function HtmlPreview({
  content,
  filePath,
}: {
  content: string
  filePath: string
}) {
  const srcDoc = useMemo(
    () => injectBaseHref(content, getFileDirectoryHref(filePath)),
    [content, filePath],
  )

  return (
    <div className='html-preview-shell'>
      <iframe
        className='html-preview-frame'
        referrerPolicy='no-referrer'
        sandbox={HTML_PREVIEW_IFRAME_SANDBOX}
        srcDoc={srcDoc}
        aria-label={`${filePath} preview`}
      />
    </div>
  )
}

export const __htmlPreviewTestHooks = {
  HTML_PREVIEW_IFRAME_SANDBOX,
  getFileDirectoryHref,
  injectBaseHref,
}
