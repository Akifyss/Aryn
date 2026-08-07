import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import postcss from 'postcss'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

const source = path.resolve(__dirname, 'src')
const arynSource = path.resolve(__dirname, '..', '..', 'src')
const upstream = path.join(source, 'upstream', 'bb')
const appSource = path.join(upstream, 'apps', 'app', 'src')
const sharedUiSource = path.join(upstream, 'packages', 'shared-ui', 'src')
const SURFACE = '.aryn-bb-session-surface'
const PORTAL = '[data-bb-plugin-root]'
const KEYFRAME_PREFIX = 'aryn-bb-'

type PostCssContainer = {
  name?: string
  parent?: PostCssContainer
  remove?: () => void
  type?: string
}

type PostCssRule = PostCssContainer & {
  remove: () => void
  selectors?: string[]
}

type PostCssAtRule = PostCssContainer & {
  params: string
}

type PostCssDeclaration = {
  prop: string
  value: string
}

type PostCssRoot = {
  walkAtRules: (callback: (rule: PostCssAtRule) => void) => void
  walkDecls: (callback: (declaration: PostCssDeclaration) => void) => void
}

function isInsideKeyframes(rule: PostCssRule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && parent.name?.toLowerCase().endsWith('keyframes')) return true
    parent = parent.parent
  }
  return false
}

function portalSelectors(value: string) {
  if (value === ':root' || value === ':host' || value === 'html' || value === 'body') {
    return [PORTAL]
  }
  if (value === '.dark' || value === 'html.dark') {
    return [`${PORTAL}[data-bb-theme="dark"]`]
  }
  if (value.startsWith('.dark ')) {
    const suffix = value.slice('.dark '.length)
    return [
      `${PORTAL}[data-bb-theme="dark"] ${suffix}`,
      `${PORTAL}[data-bb-theme="dark"]${suffix.startsWith(':') || suffix.startsWith('.') || suffix.startsWith('[') ? suffix : ''}`,
    ]
  }
  return [`${PORTAL} ${value}`, `${PORTAL}${value.startsWith(':') || value.startsWith('.') || value.startsWith('[') ? value : ''}`]
}

export function scopeBbSelector(selector: string) {
  const value = selector.trim()
  if (!value || value.startsWith('::view-transition-')) return []
  if (value.includes('.bb-app-shell-root') || value.includes('.bb-app-shell')) return []
  if (value.includes('body[data-sidebar-dragging')) return []
  if (value.startsWith(SURFACE) || value.startsWith(`.dark ${SURFACE}`)) return [value]
  if (value === ':root' || value === ':host' || value === 'html' || value === 'body') {
    return [SURFACE, PORTAL]
  }
  if (value === '.dark' || value === 'html.dark') {
    return [`${SURFACE}[data-bb-theme="dark"]`, `${PORTAL}[data-bb-theme="dark"]`]
  }
  if (value.startsWith('.dark ')) {
    const suffix = value.slice('.dark '.length)
    return [`${SURFACE}[data-bb-theme="dark"] ${suffix}`, ...portalSelectors(value)]
  }
  return [`${SURFACE} ${value}`, ...portalSelectors(value)]
}

const scopeBbCss = {
  postcssPlugin: 'aryn-scope-bb-css',
  Once(root: PostCssRoot) {
    const animationNames = new Map<string, string>()
    root.walkAtRules((rule) => {
      const name = rule.name?.toLowerCase() ?? ''
      if (!name.endsWith('keyframes')) return
      const original = rule.params.trim()
      if (!original) return
      const namespaced = `${KEYFRAME_PREFIX}${original}`
      animationNames.set(original, namespaced)
      rule.params = namespaced
    })
    root.walkDecls((declaration) => {
      if (declaration.value.includes('/bb-mark.svg')) {
        declaration.value = declaration.value.replaceAll('/bb-mark.svg', './bb-mark.svg')
      }
      if (!['animation', 'animation-name', '-webkit-animation', '-webkit-animation-name'].includes(declaration.prop)) return
      for (const [original, namespaced] of animationNames) {
        const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        declaration.value = declaration.value.replace(
          new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'),
          namespaced,
        )
      }
    })
  },
  AtRule(rule: PostCssContainer) {
    if (rule.name?.toLowerCase() === 'property') rule.remove?.()
  },
  Rule(rule: PostCssRule) {
    if (!rule.selectors || isInsideKeyframes(rule)) return
    const selectors = rule.selectors.flatMap(scopeBbSelector)
    if (selectors.length === 0) {
      rule.remove()
      return
    }
    rule.selectors = [...new Set(selectors.filter(Boolean))]
  },
}

const scopeBbCssOutput: Plugin = {
  name: 'aryn-scope-bb-css-output',
  enforce: 'post',
  async generateBundle(_options, bundle) {
    for (const asset of Object.values(bundle)) {
      if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) continue
      const sourceText = typeof asset.source === 'string'
        ? asset.source
        : new TextDecoder().decode(asset.source)
      const result = await postcss([scopeBbCss as never]).process(sourceText, {
        from: undefined,
        map: false,
      })
      asset.source = result.css
    }
  },
}

const alias = [
  { find: '@aryn/app-scroll-area', replacement: path.join(arynSource, 'components', 'app-scroll-area', 'index.ts') },
  { find: '@bb/domain', replacement: path.join(upstream, 'packages/domain/src/index.ts') },
  { find: '@bb/core-ui', replacement: path.join(upstream, 'packages/core-ui/src/index.ts') },
  { find: '@bb/server-contract', replacement: path.join(source, 'compat/server-contract.ts') },
  { find: '@bb/thread-view', replacement: path.join(upstream, 'packages/thread-view/src/index.ts') },
  { find: '@bb/plugin-sdk', replacement: path.join(source, 'compat/plugin-sdk.ts') },
  { find: '@bb/shared-ui/activity-row-styles', replacement: path.join(sharedUiSource, 'components/ui/activity-row-styles.ts') },
  { find: '@bb/shared-ui/button', replacement: path.join(sharedUiSource, 'components/ui/button.tsx') },
  { find: '@bb/shared-ui/context-menu', replacement: path.join(sharedUiSource, 'components/ui/context-menu.tsx') },
  { find: '@bb/shared-ui/dialog', replacement: path.join(sharedUiSource, 'components/ui/dialog.tsx') },
  { find: '@bb/shared-ui/dropdown-menu', replacement: path.join(sharedUiSource, 'components/ui/dropdown-menu.tsx') },
  { find: '@bb/shared-ui/empty-state', replacement: path.join(sharedUiSource, 'components/ui/empty-state.tsx') },
  { find: '@bb/shared-ui/hooks/use-compact-viewport', replacement: path.join(sharedUiSource, 'components/ui/hooks/use-compact-viewport.tsx') },
  { find: '@bb/shared-ui/hooks/use-pointer-coarse', replacement: path.join(sharedUiSource, 'components/ui/hooks/use-pointer-coarse.ts') },
  { find: '@bb/shared-ui/icon', replacement: path.join(sharedUiSource, 'components/ui/icon.tsx') },
  { find: '@bb/shared-ui/lib/utils', replacement: path.join(sharedUiSource, 'lib/utils.ts') },
  { find: '@bb/shared-ui/motion', replacement: path.join(sharedUiSource, 'components/ui/motion.ts') },
  { find: '@bb/shared-ui/overlay-trigger', replacement: path.join(sharedUiSource, 'components/ui/overlay-trigger.ts') },
  { find: '@bb/shared-ui/pill', replacement: path.join(sharedUiSource, 'components/ui/pill.tsx') },
  { find: '@bb/shared-ui/popover', replacement: path.join(sharedUiSource, 'components/ui/popover.tsx') },
  { find: '@bb/shared-ui/skeleton', replacement: path.join(sharedUiSource, 'components/ui/skeleton.tsx') },
  { find: '@bb/shared-ui/tooltip', replacement: path.join(sharedUiSource, 'components/ui/tooltip.tsx') },
  { find: '@bb/shared-ui/workflow-progress', replacement: path.join(sharedUiSource, 'components/ui/workflow-progress.tsx') },
  { find: path.join(sharedUiSource, 'lib/portal-scope.ts'), replacement: path.join(source, 'compat/portal-scope.ts') },
  { find: '@/hooks/queries/query-keys', replacement: path.join(source, 'compat/query-keys.ts') },
  { find: '@/hooks/queries/thread-queries', replacement: path.join(source, 'compat/thread-queries.ts') },
  { find: '@/hooks/useAppTheme', replacement: path.join(source, 'compat/theme.ts') },
  { find: '@/hooks/useSenderThreadMetadataById', replacement: path.join(source, 'compat/sender-thread-metadata.ts') },
  { find: '@/hooks/useTheme', replacement: path.join(source, 'compat/theme.ts') },
  { find: '@/lib/absolute-file-path', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/lib/bb-desktop', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/lib/clipboard', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/lib/file-content-urls', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/lib/file-preview', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/lib/localhost-link-rewrite-preference', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/lib/plugin-logos', replacement: path.join(source, 'compat/plugins.ts') },
  { find: '@/lib/plugin-mention-triggers', replacement: path.join(source, 'compat/plugins.ts') },
  { find: '@/lib/plugin-message-actions.js', replacement: path.join(source, 'compat/plugins.ts') },
  { find: '@/lib/plugin-slots.js', replacement: path.join(source, 'compat/plugins.ts') },
  { find: '@/lib/portal-scope', replacement: path.join(source, 'compat/portal-scope.ts') },
  { find: '@/lib/prompt-draft', replacement: path.join(source, 'compat/prompt-draft.ts') },
  { find: '@/lib/route-paths', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/lib/side-chat-plugin.js', replacement: path.join(source, 'compat/plugins.ts') },
  { find: '@/lib/thread-title', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/lib/user-attachment-images', replacement: path.join(source, 'compat/host-services.ts') },
  { find: '@/components/ui/markdown-message-directives', replacement: path.join(source, 'compat/markdown-message-directives.tsx') },
  { find: '@/components/ui/markdown-message-directives.js', replacement: path.join(source, 'compat/markdown-message-directives.tsx') },
  { find: '@', replacement: appSource },
]

export default defineConfig({
  publicDir: path.join(upstream, 'apps', 'app', 'public'),
  plugins: [tailwindcss(), react(), scopeBbCssOutput],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    '__BB_PLUGIN_ID__': 'undefined',
  },
  resolve: {
    alias,
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  build: {
    cssTarget: 'chrome120',
    cssCodeSplit: false,
    emptyOutDir: true,
    lib: {
      entry: path.join(source, 'index.tsx'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'style.css' : 'assets/[name][extname]',
      },
    },
  },
})
