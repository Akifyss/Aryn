import { access, readFile } from 'node:fs/promises'
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
      build?: {
        assetsInlineLimit?: number
        lib?: unknown
        rollupOptions?: { preserveEntrySignatures?: string }
      }
      resolve?: { alias?: Array<{ find: string; replacement: string }>; dedupe?: string[] }
    }

    expect(rootPackage.dependencies['@aryn/bb-session-surface']).toBe('file:packages/bb-session-surface')
    expect(config.resolve?.dedupe).toEqual(expect.arrayContaining(['react', 'react-dom']))
    expect(config.resolve?.alias?.some(({ find }) => find === '@aryn/app-scroll-area')).toBe(true)
    expect(config.resolve?.alias?.some(({ find }) => find === '@fontsource-variable/inter')).toBe(true)
    expect(config.resolve?.alias?.find(({ find }) => find === '@/components/ui/bottom-anchored-scroll-body.js')).toBeUndefined()
    expect(config.build?.assetsInlineLimit).toBe(0)
    expect(config.build?.lib).toBeUndefined()
    expect(config.build?.rollupOptions?.preserveEntrySignatures).toBe('strict')
  })

  it('does not retain provider-specific surface packages or build entry points', async () => {
    expect(rootPackage.dependencies).not.toHaveProperty('@aryn/codex-session-surface')
    expect(rootPackage.dependencies).not.toHaveProperty('@aryn/opencode-session-surface')
    expect(rootPackage.dependencies).not.toHaveProperty('@aryn/pi-web-session-surface')
    expect(rootPackage.scripts).not.toHaveProperty('build:codex-surface')
    expect(rootPackage.scripts).not.toHaveProperty('build:opencode-surface')
    expect(rootPackage.scripts).not.toHaveProperty('build:pi-web-surface')

    await expect(access(new URL('../packages/codex-session-surface', import.meta.url))).rejects.toThrow()
    await expect(access(new URL('../packages/opencode-session-surface', import.meta.url))).rejects.toThrow()
    await expect(access(new URL('../packages/pi-web-session-surface', import.meta.url))).rejects.toThrow()
  })

  it('lets the Aryn conversation surface own the background', async () => {
    const styles = await readFile(
      new URL('../packages/bb-session-surface/src/index.css', import.meta.url),
      'utf8',
    )

    expect(styles).toMatch(/\.aryn-bb-session-surface\s*\{[^}]*background-color:\s*transparent;/s)
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

  it('aligns the bb message column with the Aryn composer column', async () => {
    const [
      source,
      styles,
      agentChatStyles,
      composerStyles,
      messageSource,
      appScrollAreaSource,
      appScrollAreaStyles,
    ] = await Promise.all([
      readFile(
        new URL('../packages/bb-session-surface/src/index.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../packages/bb-session-surface/src/index.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/agent/components/agent-chat-surface/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/agent/components/agent-composer-surface/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL(
          '../packages/bb-session-surface/src/upstream/bb/apps/app/src/components/thread/timeline/ConversationMessageContent.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../src/components/app-scroll-area/app-scroll-area.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/components/app-scroll-area/styles.css', import.meta.url),
        'utf8',
      ),
    ])

    expect(source).toContain("maxWidthClassName='aryn-bb-session-surface__content-width'")
    expect(source).toContain("contentClassName='aryn-bb-session-surface__content-inset'")
    expect(source).toContain("scrollAreaClassName='aryn-bb-session-surface__scroll-viewport'")
    expect(styles).toContain('max-width: var(--agent-content-max-width, 800px)')
    expect(styles).toContain('padding-inline: var(--agent-messages-inline-padding, 8px)')
    expect(styles).toContain('[class~="group/message"][class~="w-full"]')
    expect(messageSource).toContain(
      'className="group/message w-full px-2 text-sm font-normal leading-relaxed"',
    )
    expect(styles).toContain('.aryn-bb-session-surface__scroll-viewport::-webkit-scrollbar')
    expect(styles).toContain('scrollbar-width: none')
    expect(source).toContain("import { AppScrollArea } from '@aryn/app-scroll-area'")
    expect(source).toContain('<AppScrollArea')
    expect(source).toContain('getExternalViewport={getScrollViewport}')
    expect(source).toContain('getExternalInteractionRoot={getScrollInteractionRoot}')
    expect(appScrollAreaSource).toContain('function ExternalAppScrollArea')
    expect(appScrollAreaSource).toContain("'app-scroll-area-external-overlay'")
    expect(appScrollAreaSource).toContain(
      "viewport.dispatchEvent(new PointerEvent('pointerdown'",
    )
    expect(appScrollAreaStyles).toContain('.app-scroll-area-external-overlay')
    expect(composerStyles).toContain('max-width: var(--agent-content-max-width)')
    expect(agentChatStyles).toContain(
      '--agent-messages-inline-padding: var(--workspace-surface-edge-gap);',
    )
    expect(composerStyles).toContain(
      '--agent-composer-padding-inline: var(--workspace-surface-edge-gap);',
    )
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
      ':is(.aryn-bb-session-surface,[data-bb-plugin-root])',
    ])
    expect(scopeBbSelector('.timeline-row')).toEqual([
      ':is(.aryn-bb-session-surface,[data-bb-plugin-root]) .timeline-row',
      '[data-bb-plugin-root].timeline-row',
    ])
    expect(scopeBbSelector('.dark .timeline-row')).toEqual([
      ':is(.aryn-bb-session-surface,[data-bb-plugin-root])[data-bb-theme="dark"] .timeline-row',
      '[data-bb-plugin-root][data-bb-theme="dark"].timeline-row',
    ])
    expect(scopeBbSelector('[data-bb-plugin-root] .transition-all')).toEqual([
      '[data-bb-plugin-root] .transition-all',
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

  it('uses the bb surface as the only native-session rendering branch', async () => {
    const source = await readFile(
      new URL('../src/features/agent/components/agent-chat-surface/agent-chat-surface.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toContain('visibleWorkspacePath && nativeSession ?')
    expect(source).toContain('<BbSessionTimeline')
    expect(source).not.toContain('sessionView')
    expect(source).not.toContain('<CodexSessionTimeline')
    expect(source).not.toContain('<OpenCodeSessionTimeline')
    expect(source).not.toContain('<PiWebSessionTimeline')
  })

  it('keeps shared loading, retry, and error controls around every unified provider', async () => {
    const [hostSource, surfaceSource] = await Promise.all([
      readFile(
        new URL('../src/features/agent/components/bb-session-timeline/bb-session-timeline.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../packages/bb-session-surface/src/index.tsx', import.meta.url),
        'utf8',
      ),
    ])

    expect(hostSource).toContain('data-bb-agent-id={snapshot.agentId}')
    expect(hostSource).toContain("aria-busy={isSurfaceMountPending ? 'true' : undefined}")
    expect(hostSource).not.toContain("import { AppLoadingState")
    expect(hostSource).not.toContain('<AppLoadingState')
    expect(hostSource).toContain("role='alert'")
    expect(hostSource).toContain('setLoadRevision((value) => value + 1)')
    expect(hostSource).not.toContain('requestNativeView')
    expect(hostSource).not.toContain('onRequestNativeView')
    expect(hostSource).toContain('surface?.dispose()')
    expect(hostSource).toContain('container.replaceChildren()')
    expect(surfaceSource).toContain('Retry unified view')
    expect(surfaceSource).toContain('onClick={this.handleRetry}')
    expect(surfaceSource).not.toContain('Switch to native view')
  })
})
