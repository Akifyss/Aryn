import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PINNED_COMMIT = '74d25d1ab6a4dd431f225a67ec9c53f0d8b714d7'
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const packageRoot = path.join(repositoryRoot, 'packages', 'bb-session-surface')
const upstreamRoot = path.join(packageRoot, 'src', 'upstream', 'bb')
const sourceRoot = path.resolve(process.argv[2] ?? '')

if (!process.argv[2]) {
  throw new Error('Usage: node scripts/vendor-bb-session-surface.mjs <path-to-bb-checkout>')
}

const sourceCommit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()

if (sourceCommit !== PINNED_COMMIT) {
  throw new Error(`Expected bb ${PINNED_COMMIT}, received ${sourceCommit}`)
}

const normalizedPackageRoot = `${path.resolve(packageRoot)}${path.sep}`
const normalizedUpstreamRoot = path.resolve(upstreamRoot)
if (!`${normalizedUpstreamRoot}${path.sep}`.startsWith(normalizedPackageRoot)) {
  throw new Error(`Refusing to replace unexpected upstream directory: ${normalizedUpstreamRoot}`)
}

await rm(normalizedUpstreamRoot, { recursive: true, force: true })
await mkdir(normalizedUpstreamRoot, { recursive: true })

function normalizeRelativePath(value) {
  return value.split(path.sep).join('/')
}

async function isFile(filePath) {
  try {
    return (await stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function listFiles(directory, predicate = () => true) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath, predicate))
    } else if (entry.isFile() && predicate(entryPath)) {
      files.push(entryPath)
    }
  }
  return files
}

async function resolveTypeScriptModule(root, importer, specifier) {
  let candidate
  if (specifier.startsWith('@/')) {
    candidate = path.join(root, specifier.slice(2))
  } else if (specifier.startsWith('.')) {
    candidate = path.resolve(path.dirname(importer), specifier)
  } else {
    return null
  }

  if (candidate.endsWith('.js')) {
    candidate = candidate.slice(0, -3)
  }

  const candidates = [
    candidate,
    `${candidate}.ts`,
    `${candidate}.tsx`,
    `${candidate}.css`,
    path.join(candidate, 'index.ts'),
    path.join(candidate, 'index.tsx'),
  ]
  for (const value of candidates) {
    if (await isFile(value)) return path.resolve(value)
  }
  return null
}

const importPattern = /(?:from\s+|import\s+)["']([^"']+)["']/g

async function collectModuleClosure({ root, starts, shouldTraverse }) {
  const queue = starts.map((value) => path.resolve(root, value))
  const files = new Set()
  while (queue.length > 0) {
    const filePath = queue.shift()
    if (!filePath || files.has(filePath)) continue
    if (!await isFile(filePath)) {
      throw new Error(`Missing vendored source file: ${filePath}`)
    }
    files.add(filePath)
    const source = await readFile(filePath, 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const resolved = await resolveTypeScriptModule(root, filePath, match[1])
      if (resolved && shouldTraverse(resolved, root)) queue.push(resolved)
    }
  }
  return [...files]
}

const appSourceRoot = path.join(sourceRoot, 'apps', 'app', 'src')
const appComponentFiles = await collectModuleClosure({
  root: appSourceRoot,
  starts: [
    'components/thread/timeline/ThreadTimelineRows.tsx',
    'components/thread/timeline/ThreadTimelineSurface.tsx',
    'views/thread-detail/ThreadTimelineScrollToBottomButton.tsx',
  ],
  shouldTraverse(filePath, root) {
    const relativePath = path.relative(root, filePath)
    return relativePath === 'components' || relativePath.startsWith(`components${path.sep}`)
  },
})

const appTimelineRoot = path.join(appSourceRoot, 'components', 'thread', 'timeline')
const additionalTimelineFiles = await listFiles(
  appTimelineRoot,
  (filePath) => /\.(?:ts|tsx)$/.test(filePath) && !/\.(?:test|stories)\./.test(filePath),
)

const threadViewRoot = path.join(sourceRoot, 'packages', 'thread-view', 'src')
// The entire package is bb's pure event-to-timeline vertical slice. Do not
// reduce this to an import closure: provider events that are uncommon in Aryn
// today still need their upstream projection path available when they appear.
const threadViewFiles = await listFiles(
  threadViewRoot,
  (filePath) => /\.ts$/.test(filePath),
)

const sharedUiRoot = path.join(sourceRoot, 'packages', 'shared-ui', 'src')
const sharedUiFiles = await collectModuleClosure({
  root: sharedUiRoot,
  starts: [
    'components/ui/button.tsx',
    'components/ui/context-menu.tsx',
    'components/ui/dialog.tsx',
    'components/ui/dropdown-menu.tsx',
    'components/ui/empty-state.tsx',
    'components/ui/hooks/use-compact-viewport.tsx',
    'components/ui/hooks/use-pointer-coarse.ts',
    'components/ui/icon.tsx',
    'components/ui/motion.ts',
    'components/ui/overlay-trigger.ts',
    'components/ui/pill.tsx',
    'components/ui/popover.tsx',
    'components/ui/skeleton.tsx',
    'components/ui/tooltip.tsx',
    'components/ui/workflow-progress.tsx',
    'lib/utils.ts',
  ],
  shouldTraverse(filePath, root) {
    const relativePath = path.relative(root, filePath)
    return relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`)
  },
})

const domainRoot = path.join(sourceRoot, 'packages', 'domain', 'src')
const domainFiles = await listFiles(domainRoot, (filePath) => /\.ts$/.test(filePath))
const coreUiRoot = path.join(sourceRoot, 'packages', 'core-ui', 'src')
const coreUiFiles = await listFiles(coreUiRoot, (filePath) => /\.ts$/.test(filePath))

const exactFiles = new Set([
  ...appComponentFiles,
  ...additionalTimelineFiles,
  ...threadViewFiles,
  ...sharedUiFiles,
  ...domainFiles,
  ...coreUiFiles,
  path.join(appSourceRoot, 'app.css'),
  path.join(appSourceRoot, 'components', 'ui', 'theme.css'),
  path.join(appSourceRoot, 'lib', 'thread-timeline-scroll-anchor.ts'),
  path.join(sourceRoot, 'apps', 'app', 'public', 'bb-mark.svg'),
  path.join(sourceRoot, 'packages', 'server-contract', 'src', 'thread-timeline.ts'),
])

const manifest = []
for (const sourcePath of [...exactFiles].sort()) {
  const upstreamPath = normalizeRelativePath(path.relative(sourceRoot, sourcePath))
  const targetPath = path.join(normalizedUpstreamRoot, upstreamPath)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await cp(sourcePath, targetPath)
  const contents = await readFile(sourcePath)
  manifest.push({
    path: `src/upstream/bb/${upstreamPath}`,
    sha256: createHash('sha256').update(contents).digest('hex').toUpperCase(),
    upstreamPath,
  })
}

await cp(path.join(sourceRoot, 'LICENSE'), path.join(packageRoot, 'LICENSE'))
await writeFile(
  path.join(packageRoot, 'vendor-manifest.json'),
  `${JSON.stringify({
    repository: 'https://github.com/ymichael/bb.git',
    upstreamCommit: PINNED_COMMIT,
    files: manifest,
  }, null, 2)}\n`,
  'utf8',
)

console.log(`Vendored ${manifest.length} files from bb ${PINNED_COMMIT}.`)
