import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import rootPackage from '../package.json'
import surfacePackage from '../packages/bb-session-surface/package.json'
import manifest from '../packages/bb-session-surface/vendor-manifest.json'
import surfaceConfig, { scopeBbSelector } from '../packages/bb-session-surface/vite.config'

describe('bb unified session surface build contract', () => {
  it('pins the vendored source and ships provenance with the package', () => {
    expect(manifest.repository).toBe('https://github.com/ymichael/bb.git')
    expect(manifest.upstreamCommit).toBe('74d25d1ab6a4dd431f225a67ec9c53f0d8b714d7')
    expect(manifest.files).toHaveLength(232)
    expect(manifest.files.filter(({ upstreamPath }) => upstreamPath.startsWith('packages/thread-view/src/'))).toHaveLength(57)
    expect(manifest.files.map(({ upstreamPath }) => upstreamPath)).toEqual(expect.arrayContaining([
      'apps/app/src/components/ui/bottom-anchored-scroll-body.tsx',
      'apps/app/src/components/ui/scroll-to-bottom-button.tsx',
      'apps/app/src/lib/thread-timeline-scroll-anchor.ts',
      'apps/app/src/views/thread-detail/ThreadTimelineScrollToBottomButton.tsx',
      'apps/app/public/bb-mark.svg',
    ]))
    expect(surfacePackage.files).toEqual(expect.arrayContaining([
      'LICENSE',
      'UPSTREAM.md',
      'vendor-manifest.json',
    ]))
  })

  it('keeps the bb runtime isolated while sharing one React identity internally', () => {
    const config = surfaceConfig as {
      resolve?: { alias?: Array<{ find: string; replacement: string }>; dedupe?: string[] }
    }

    expect(rootPackage.dependencies['@aryn/bb-session-surface']).toBe('file:packages/bb-session-surface')
    expect(config.resolve?.dedupe).toEqual(expect.arrayContaining(['react', 'react-dom']))
    expect(config.resolve?.alias?.find(({ find }) => find === '@/components/ui/bottom-anchored-scroll-body.js')).toBeUndefined()
  })

  it('mounts bb timeline rows inside the exact upstream bottom-anchor owner', async () => {
    const source = await readFile(
      new URL('../packages/bb-session-surface/src/index.tsx', import.meta.url),
      'utf8',
    )
    const hostSource = await readFile(
      new URL('../src/features/agent/components/bb-session-timeline/bb-session-timeline.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain("from './upstream/bb/apps/app/src/components/ui/bottom-anchored-scroll-body'")
    expect(source).toContain('<BottomAnchoredScrollBody')
    expect(source).toContain('<ThreadTimelineScrollToBottomButton')
    expect(source).toContain('scrollAnchorThreadId={options.sessionId}')
    expect(source).toContain('onLoadOlderRows={options.bridge?.loadOlderTimelineRows}')
    expect(source).toContain('hasOlderTimelineRows={options.paginationState?.hasOlderTimelineRows ?? false}')
    expect(hostSource).not.toContain('AppScrollArea')
  })

  it('adds accessibility and long-timeline safeguards outside the exact upstream mirror', async () => {
    const source = await readFile(
      new URL('../packages/bb-session-surface/src/index.tsx', import.meta.url),
      'utf8',
    )
    const styles = await readFile(
      new URL('../packages/bb-session-surface/src/index.css', import.meta.url),
      'utf8',
    )

    expect(source).toContain("const KEYBOARD_IMAGE_SELECTOR = 'img.cursor-zoom-in'")
    expect(source).toContain("image.dataset.bbKeyboardImage = 'true'")
    expect(source).toContain("image.setAttribute('role', 'button')")
    expect(source).toContain("root.addEventListener('keydown', handleKeyDown)")
    expect(source).toContain("aria-live='polite'")
    expect(source).toContain('<RuntimeStatusAnnouncer')
    expect(styles).toContain('button[aria-expanded]:focus-visible')
    expect(styles).toContain('img[data-bb-keyboard-image="true"]:focus-visible')
    expect(styles).toContain('.aryn-bb-session-surface [data-timeline-row-id]')
    expect(styles).toContain('content-visibility: auto')
  })

  it('scopes bb styles and drops document-shell selectors', () => {
    expect(scopeBbSelector(':root')).toEqual([
      '.aryn-bb-session-surface',
      '[data-bb-plugin-root]',
    ])
    expect(scopeBbSelector('.timeline-row')).toEqual([
      '.aryn-bb-session-surface .timeline-row',
      '[data-bb-plugin-root] .timeline-row',
      '[data-bb-plugin-root].timeline-row',
    ])
    expect(scopeBbSelector('.dark .timeline-row')).toEqual([
      '.aryn-bb-session-surface[data-bb-theme="dark"] .timeline-row',
      '[data-bb-plugin-root][data-bb-theme="dark"] .timeline-row',
      '[data-bb-plugin-root][data-bb-theme="dark"].timeline-row',
    ])
    expect(scopeBbSelector('.bb-app-shell-root')).toEqual([])
    expect(scopeBbSelector('body[data-sidebar-dragging="true"]')).toEqual([])
  })

  it('requires an explicit theme and does not inspect host document classes', async () => {
    const contractsSource = await readFile(
      new URL('../packages/bb-session-surface/src/contracts.ts', import.meta.url),
      'utf8',
    )
    const themeSource = await readFile(
      new URL('../packages/bb-session-surface/src/compat/theme.ts', import.meta.url),
      'utf8',
    )
    const hostSource = await readFile(
      new URL('../src/features/agent/components/bb-session-timeline/bb-session-timeline.tsx', import.meta.url),
      'utf8',
    )

    expect(contractsSource).toContain('theme: BbTheme')
    expect(contractsSource).toContain('setTheme: (theme: BbTheme) => void')
    expect(themeSource).toContain('BbThemeContext')
    expect(themeSource).not.toContain('document.documentElement')
    expect(themeSource).not.toContain('document.body')
    expect(themeSource).not.toContain('MutationObserver')
    expect(hostSource).toContain('theme: themeRef.current')
    expect(hostSource).toContain('surfaceRef.current?.setTheme(theme)')
  })

  it('defaults all native providers to the unified branch and retains native branches', async () => {
    const source = await readFile(
      new URL('../src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain("sessionView === 'unified'")
    expect(source).toContain('<BbSessionTimeline')
    expect(source).toContain('<CodexSessionTimeline')
    expect(source).toContain('openCodeNativeSession={openCodeNativeSession}')
    expect(source).toContain('piWebNativeSession={piWebNativeSession}')
  })

  it('keeps shared loading, retry, error, and native fallback controls around every unified provider', async () => {
    const source = await readFile(
      new URL('../src/features/agent/components/bb-session-timeline/bb-session-timeline.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('data-bb-agent-id={snapshot.agentId}')
    expect(source).toContain("aria-busy={isLoading ? 'true' : undefined}")
    expect(source).toContain("role='status'")
    expect(source).toContain("role='alert'")
    expect(source).toContain('setLoadRevision((value) => value + 1)')
    expect(source).toContain('onClick={onRequestNativeView}')
    expect(source).toContain('surface?.dispose()')
    expect(source).toContain('container.replaceChildren()')
  })
})
