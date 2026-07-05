import * as React from 'react'
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from '@pierre/trees'

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

// A single SVG source so the same folder glyph can render in the workspace
// tree, the File System light DOM, and @pierre/trees shadow DOM CSS.
const DEFAULT_WORKSPACE_FOLDER_GLYPH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 50" width="64" height="50"><defs><linearGradient id="fs-folder-back" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#3dabf5"/><stop offset="1" stop-color="#1d84dd"/></linearGradient><linearGradient id="fs-folder-front" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#7accfb"/><stop offset="1" stop-color="#37a0ef"/></linearGradient></defs><path d="M5 10c0-3.31 2.69-6 6-6h10.9c1.6 0 3.13.7 4.18 1.9l1.5 1.73a3.5 3.5 0 0 0 2.64 1.22H54c2.76 0 5 2.24 5 5V40c0 3.87-3.13 7-7 7H12c-3.87 0-7-3.13-7-7V10Z" fill="url(#fs-folder-back)"/><path d="M5 15.5h54V40c0 3.87-3.13 7-7 7H12c-3.87 0-7-3.13-7-7V15.5Z" fill="url(#fs-folder-front)"/></svg>`

export const DEFAULT_WORKSPACE_FOLDER_GLYPH_DATA_URL =
  `data:image/svg+xml,${encodeURIComponent(DEFAULT_WORKSPACE_FOLDER_GLYPH_SVG)}`

const DEFAULT_WORKSPACE_FILE_ICON_SPRITE_SHEET = getBuiltInSpriteSheet('complete')

const { resolveIcon: resolveDefaultWorkspaceFileIcon } = createFileTreeIconResolver({
  colored: true,
  set: 'complete',
})

// Per-token light/dark colors mirroring the palette @pierre/trees applies
// inside its shadow DOM. Tokens without an entry stay muted-foreground there
// too, and use the same foreground fallback here.
const DEFAULT_WORKSPACE_FILE_ICON_COLORS: Record<string, [light: string, dark: string]> = {
  astro: ['#a631be', '#d568ea'],
  babel: ['#d5a910', '#ffd452'],
  bash: ['#199f43', '#5ecc71'],
  biome: ['#1a85d4', '#69b1ff'],
  bootstrap: ['#693acf', '#9d6afb'],
  browserslist: ['#d5a910', '#ffd452'],
  bun: ['#594c5b', '#79697b'],
  c: ['#1a85d4', '#69b1ff'],
  claude: ['#d47628', '#ffa359'],
  cpp: ['#1a85d4', '#69b1ff'],
  css: ['#693acf', '#9d6afb'],
  database: ['#a631be', '#d568ea'],
  default: ['#84848a', '#adadb1'],
  docker: ['#1a85d4', '#69b1ff'],
  eslint: ['#693acf', '#9d6afb'],
  git: ['#ff8c5b', '#d5512f'],
  go: ['#1ca1c7', '#68cdf2'],
  graphql: ['#d32a61', '#ff678d'],
  html: ['#d47628', '#ffa359'],
  image: ['#d32a61', '#ff678d'],
  javascript: ['#d5a910', '#ffd452'],
  json: ['#d47628', '#ffa359'],
  markdown: ['#199f43', '#5ecc71'],
  mcp: ['#17a5af', '#64d1db'],
  npm: ['#d52c36', '#ff6762'],
  oxc: ['#1ca1c7', '#68cdf2'],
  postcss: ['#d52c36', '#ff6762'],
  prettier: ['#17a5af', '#64d1db'],
  python: ['#1a85d4', '#69b1ff'],
  react: ['#1ca1c7', '#68cdf2'],
  ruby: ['#d52c36', '#ff6762'],
  rust: ['#d47628', '#ffa359'],
  sass: ['#d32a61', '#ff678d'],
  svelte: ['#d52c36', '#ff6762'],
  svg: ['#d47628', '#ffa359'],
  svgo: ['#199f43', '#5ecc71'],
  swift: ['#d47628', '#ffa359'],
  table: ['#17a5af', '#64d1db'],
  tailwind: ['#1ca1c7', '#68cdf2'],
  terraform: ['#693acf', '#9d6afb'],
  text: ['#84848a', '#adadb1'],
  typescript: ['#1a85d4', '#69b1ff'],
  vite: ['#a631be', '#d568ea'],
  vscode: ['#1a85d4', '#69b1ff'],
  vue: ['#199f43', '#5ecc71'],
  wasm: ['#693acf', '#9d6afb'],
  webpack: ['#1a85d4', '#69b1ff'],
  yml: ['#d52c36', '#ff6762'],
  zig: ['#d47628', '#ffa359'],
  zip: ['#d47628', '#ffa359'],
}

const DEFAULT_WORKSPACE_FILE_ICON_ASSET_ROOT_ID = 'aryn-default-workspace-file-icon-assets'
const DEFAULT_WORKSPACE_FILE_ICON_SPRITE_ID = 'aryn-default-workspace-file-icon-sprite'
const DEFAULT_WORKSPACE_FILE_ICON_STYLE_ID = 'aryn-default-workspace-file-icon-style'

function fileIconColorVariables(mode: 0 | 1) {
  return Object.entries(DEFAULT_WORKSPACE_FILE_ICON_COLORS)
    .map(([token, colors]) => `--fs-file-icon-${token}: ${colors[mode]};`)
    .join(' ')
}

const DEFAULT_WORKSPACE_FILE_ICON_COLOR_CSS = `
:root { ${fileIconColorVariables(0)} --fs-selected-color-scheme: dark; }
.dark { ${fileIconColorVariables(1)} --fs-selected-color-scheme: light; }
.dark [data-file-system-on-light] { ${fileIconColorVariables(0)} }
[data-file-system-on-primary] { ${fileIconColorVariables(1)} }
.dark [data-file-system-on-primary] { ${fileIconColorVariables(0)} }
`

function appendDefaultWorkspaceFileIconAssets() {
  if (typeof document === 'undefined') return

  if (!document.getElementById(DEFAULT_WORKSPACE_FILE_ICON_SPRITE_ID)) {
    const root = document.createElement('div')
    root.id = DEFAULT_WORKSPACE_FILE_ICON_ASSET_ROOT_ID
    root.setAttribute('aria-hidden', 'true')
    root.style.display = 'none'

    const spriteHost = document.createElement('span')
    spriteHost.id = DEFAULT_WORKSPACE_FILE_ICON_SPRITE_ID
    spriteHost.innerHTML = DEFAULT_WORKSPACE_FILE_ICON_SPRITE_SHEET
    root.append(spriteHost)

    ;(document.body ?? document.documentElement).prepend(root)
  }

  if (!document.getElementById(DEFAULT_WORKSPACE_FILE_ICON_STYLE_ID)) {
    const style = document.createElement('style')
    style.id = DEFAULT_WORKSPACE_FILE_ICON_STYLE_ID
    style.textContent = DEFAULT_WORKSPACE_FILE_ICON_COLOR_CSS
    ;(document.head ?? document.documentElement).append(style)
  }
}

export function useDefaultWorkspaceFileIconAssets() {
  React.useInsertionEffect(() => {
    appendDefaultWorkspaceFileIconAssets()
  }, [])
}

export function DefaultWorkspaceFileIconAssets() {
  useDefaultWorkspaceFileIconAssets()
  return null
}

export function resolveDefaultWorkspaceFileTypeIcon(fileName: string) {
  return resolveDefaultWorkspaceFileIcon('file-tree-icon-file', fileName)
}

export function DefaultWorkspaceFileTypeIcon({
  className,
  fileName,
}: {
  className?: string
  fileName: string
}) {
  useDefaultWorkspaceFileIconAssets()

  const icon = resolveDefaultWorkspaceFileTypeIcon(fileName)

  return (
    <svg
      aria-hidden='true'
      viewBox={icon.viewBox ?? '0 0 16 16'}
      className={cn('shrink-0 text-[var(--foreground-secondary)]', className)}
      style={
        icon.token
          ? {
              color: `var(--fs-file-icon-${icon.token}, var(--foreground-secondary))`,
            }
          : undefined
      }
    >
      <use href={`#${icon.name}`} />
    </svg>
  )
}

export function DefaultWorkspaceFolderGlyph({ className }: { className?: string }) {
  return (
    <img
      src={DEFAULT_WORKSPACE_FOLDER_GLYPH_DATA_URL}
      alt=''
      aria-hidden='true'
      draggable={false}
      className={className}
    />
  )
}

function fileExtension(fileName: string) {
  const segments = fileName.split('.')

  if (segments.length <= 1) return ''

  return segments.at(-1)?.toUpperCase() ?? ''
}

export function DefaultWorkspaceFileTypePreview({
  className,
  fileName,
  iconClassName,
}: {
  className?: string
  fileName: string
  iconClassName?: string
}) {
  const extension = fileExtension(fileName)

  return (
    <div
      data-file-system-on-light=''
      className={cn(
        'flex size-full flex-col items-center justify-center gap-1.5 bg-white text-neutral-400 dark:bg-neutral-100',
        className,
      )}
    >
      <DefaultWorkspaceFileTypeIcon
        fileName={fileName}
        className={cn('size-1/3 min-h-4 min-w-4', iconClassName)}
      />
      {extension ? (
        <span className='text-[min(0.625rem,18cqw)] font-semibold tracking-wide uppercase'>
          {extension}
        </span>
      ) : null}
    </div>
  )
}
