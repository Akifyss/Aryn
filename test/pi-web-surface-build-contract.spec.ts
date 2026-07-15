import { describe, expect, it } from 'vitest'
import surfacePackage from '../packages/pi-web-session-surface/package.json'
import surfaceConfig, {
  preparePiWebCssSource,
  scopePiWebSelector,
} from '../packages/pi-web-session-surface/vite.config'

describe('pi-web surface build contract', () => {
  it('deduplicates the React runtime used by the embedded surface', () => {
    const config = surfaceConfig as { resolve?: { dedupe?: string[] } }

    expect(config.resolve?.dedupe).toContain('react')
    expect(config.resolve?.dedupe).toContain('react-dom')
  })

  it('keeps theme variables but discards upstream document geometry', () => {
    expect(scopePiWebSelector(':root')).toEqual(['.aryn-pi-web-session-surface'])
    expect(scopePiWebSelector('html')).toEqual([])
    expect(scopePiWebSelector('body')).toEqual([])
    expect(scopePiWebSelector('.dark')).toEqual(['.dark .aryn-pi-web-session-surface'])
    expect(scopePiWebSelector('.markdown-body')).toEqual([
      '.aryn-pi-web-session-surface .markdown-body',
    ])
  })

  it('ships upstream provenance and license files with the package', () => {
    expect(surfacePackage.files).toEqual(expect.arrayContaining(['LICENSE', 'UPSTREAM.md']))
  })

  it('removes the upstream document Tailwind entry before Vite resolves it', () => {
    const prepared = preparePiWebCssSource(`
      @import "tailwindcss";
      @theme { --color-bg: var(--bg); }
      :root { --bg: white; }
    `)

    expect(prepared).not.toContain('@import "tailwindcss"')
    expect(prepared).not.toContain('@theme')
    expect(prepared).toContain(':root { --bg: white; }')
  })
})
