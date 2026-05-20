import { describe, expect, it } from 'vitest'
import { __htmlPreviewTestHooks } from '../src/features/editor/components/html-preview'

describe('HTML preview', () => {
  it('builds file base hrefs with path-segment encoding while preserving Windows drive letters', () => {
    expect(__htmlPreviewTestHooks.getFileDirectoryHref('/Users/me/site #1/index.html')).toBe(
      'file:///Users/me/site%20%231/',
    )
    expect(__htmlPreviewTestHooks.getFileDirectoryHref('C:\\workspace\\site?draft\\index.html')).toBe(
      'file:///C:/workspace/site%3Fdraft/',
    )
  })

  it('injects a base href without replacing an existing base tag', () => {
    expect(
      __htmlPreviewTestHooks.injectBaseHref(
        '<!doctype html><html><head><title>Page</title></head><body><img src="asset.png"></body></html>',
        'file:///workspace/site/',
      ),
    ).toContain('<head><base href="file:///workspace/site/"><title>Page</title>')

    const withBase = '<html><head><base href="https://example.test/"></head><body></body></html>'
    expect(__htmlPreviewTestHooks.injectBaseHref(withBase, 'file:///workspace/site/')).toBe(withBase)
  })

  it('keeps default previews sandboxed without script execution privileges', () => {
    expect(__htmlPreviewTestHooks.HTML_PREVIEW_IFRAME_SANDBOX).toBe('')
  })
})
