import { describe, expect, it } from 'vitest'
import rootPackage from '../package.json'
import surfacePackage from '../packages/opencode-session-surface/package.json'
import surfaceConfig, {
  namespaceOpenCodeAnimationName,
  namespaceOpenCodeFontFamilyName,
  namespaceOpenCodeLayerParams,
  scopeOpenCodeSelector,
  shouldScopeOpenCodeRule,
} from '../packages/opencode-session-surface/vite.config'

describe('OpenCode official surface build contract', () => {
  it('deduplicates the Solid runtime used by providers and message components', () => {
    const config = surfaceConfig as { resolve?: { dedupe?: string[] } }

    expect(config.resolve?.dedupe).toContain('solid-js')
  })

  it('pins the host and official UI to the same OpenCode release', () => {
    expect(rootPackage.dependencies['@opencode-ai/sdk']).toBe('1.17.18')
    expect(surfacePackage.dependencies['@opencode-ai/sdk']).toBe(rootPackage.dependencies['@opencode-ai/sdk'])
    expect(surfacePackage.dependencies['@opencode-ai/ui']).toBe(rootPackage.dependencies['@opencode-ai/sdk'])
  })

  it('namespaces official document CSS without retaining its legacy layout branch', () => {
    expect(scopeOpenCodeSelector(':root')).toEqual([
      '.aryn-opencode-session-surface',
      'body > .aryn-opencode-portal-theme',
    ])
    expect(scopeOpenCodeSelector('html')).toEqual([
      '.aryn-opencode-session-surface',
      'body > .aryn-opencode-portal-theme',
    ])
    expect(scopeOpenCodeSelector(':host')).toEqual([
      '.aryn-opencode-session-surface',
      'body > .aryn-opencode-portal-theme',
    ])
    expect(scopeOpenCodeSelector('html[data-theme="oc-2"] [data-component="markdown"]')).toEqual([
      '.aryn-opencode-session-surface [data-component="markdown"]',
      'body > .aryn-opencode-portal-theme [data-component="markdown"]',
    ])
    expect(scopeOpenCodeSelector('body[data-new-layout] [data-component="markdown"]')).toEqual([
      '.aryn-opencode-session-surface [data-component="markdown"]',
      'body > .aryn-opencode-portal-theme [data-component="markdown"]',
    ])
    expect(scopeOpenCodeSelector('[data-component="basic-tool"]')).toEqual([
      '.aryn-opencode-session-surface [data-component="basic-tool"]',
      'body > .aryn-opencode-portal-theme [data-component="basic-tool"]',
    ])
    expect(scopeOpenCodeSelector('body:not([data-new-layout]) [data-component="markdown"]')).toEqual([])
    expect(scopeOpenCodeSelector('&:hover')).toEqual(['&:hover'])
  })

  it('isolates global CSS registries used by the embedded official surface', () => {
    expect(namespaceOpenCodeAnimationName('overlayShow')).toBe('aryn-opencode-overlayShow')
    expect(namespaceOpenCodeFontFamilyName('KaTeX_Main')).toBe('aryn-opencode-KaTeX_Main')
    expect(namespaceOpenCodeLayerParams('theme, base, components, utilities')).toBe(
      'aryn-opencode.theme, aryn-opencode.base, aryn-opencode.components, aryn-opencode.utilities',
    )
  })

  it('ships upstream provenance and license files with the package', () => {
    expect(surfacePackage.files).toEqual(expect.arrayContaining(['LICENSE', 'UPSTREAM.md']))
  })

  it('scopes only the root of an official nested selector tree', () => {
    expect(shouldScopeOpenCodeRule({ parent: { type: 'atrule' }, remove: () => undefined })).toBe(true)
    expect(shouldScopeOpenCodeRule({
      parent: { parent: { type: 'atrule' }, type: 'rule' },
      remove: () => undefined,
    })).toBe(false)
  })
})
