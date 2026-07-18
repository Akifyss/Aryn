import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const source = path.resolve(__dirname, 'src')
const SURFACE = '.aryn-codex-session-surface'

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

function isInsideKeyframes(rule: PostCssRule) {
  let parent = rule.parent
  while (parent) {
    if (parent.type === 'atrule' && parent.name?.toLowerCase().endsWith('keyframes')) return true
    parent = parent.parent
  }
  return false
}

export function scopeCodexSelector(selector: string) {
  const value = selector.trim()
  if (!value) return []
  if (value.startsWith(SURFACE) || value.startsWith(`.dark ${SURFACE}`)) return [value]
  if (value === ':root' || value === ':host' || value === 'html' || value === 'body') return [SURFACE]
  if (value === '.dark' || value === 'html.dark') return [`.dark ${SURFACE}`]
  if (value.startsWith('.dark ')) return [`.dark ${SURFACE} ${value.slice('.dark '.length)}`]
  return [`${SURFACE} ${value}`]
}

const scopeCodexCss = {
  postcssPlugin: 'aryn-scope-codex-css',
  AtRule(rule: PostCssContainer) {
    if (rule.name?.toLowerCase() === 'property') rule.remove?.()
  },
  Rule(rule: PostCssRule) {
    if (!rule.selectors || isInsideKeyframes(rule)) return
    const selectors = rule.selectors.flatMap(scopeCodexSelector)
    if (selectors.length === 0) {
      rule.remove()
      return
    }
    rule.selectors = [...new Set(selectors)]
  },
}

export default defineConfig({
  plugins: [tailwindcss(), react()],
  css: {
    postcss: {
      plugins: [scopeCodexCss],
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  resolve: {
    alias: {
      '@t3tools/contracts/settings': path.join(source, 'compat/contracts.ts'),
      '@t3tools/contracts': path.join(source, 'compat/contracts.ts'),
      '@t3tools/client-runtime/environment': path.join(source, 'compat/environment.ts'),
      '@t3tools/shared/chatList': path.join(source, 'compat/chat-list.ts'),
      '@pierre/diffs/react': path.join(source, 'compat/pierre-diffs-react.tsx'),
      'effect/Equal': path.join(source, 'compat/effect-equal.ts'),
      '~': path.join(source),
    },
    dedupe: ['react', 'react-dom'],
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
