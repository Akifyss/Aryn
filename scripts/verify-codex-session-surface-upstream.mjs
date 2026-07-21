import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const pinnedFiles = new Map([
  [
    'packages/codex-session-surface/src/lib/turnDiffTree.ts',
    '0481A43667214018A771D522517D443BE73DE90F701164355817758E055A1B65',
  ],
  [
    'packages/codex-session-surface/src/upstream/t3code/ChangedFilesTree.tsx',
    '60C7EEBFEBFC7606B3131D33C78F0EFDF71856427863A8014CEBC93ED10AA6C5',
  ],
  [
    'packages/codex-session-surface/src/upstream/t3code/DiffStatLabel.tsx',
    '5A29B1A1DEA9650D97BE83597F94EB5B3C77906BF54FA2A3C62922192EF9CBED',
  ],
  [
    'packages/codex-session-surface/src/upstream/t3code/MessagesTimeline.tsx',
    'EF6A1EA795EBB3879EA7F161B07752D342E4709143A585F3806B8D1CCA1C8AD2',
  ],
  [
    'packages/codex-session-surface/src/upstream/t3code/MessagesTimeline.logic.ts',
    '476073FA92A7EA65FBD030A96D8C49441D34583EC5D7F0D93292A514A1548820',
  ],
  [
    'packages/codex-session-surface/src/upstream/t3code/ExpandedImageDialog.tsx',
    'D69F6439705DA50DACFB670F051711A985B1AC57C08B21C7F2112ED1D5634818',
  ],
  [
    'packages/codex-session-surface/src/upstream/t3code/ExpandedImagePreview.tsx',
    '8A34D56939E6EE85A0197143A9BD1BA74A5D953798271AFE16672769EE813BAC',
  ],
  [
    'packages/codex-session-surface/src/upstream/ui/button.tsx',
    'FE6BC89C8B14DE0C9EE5809FE23413BBC3C511DED6FEFE83560A0CDAA8346AD4',
  ],
  [
    'packages/codex-session-surface/src/upstream/ui/tooltip.tsx',
    'E5256796D7AC9F5FBCC13F2D417A528811D3734930881CBF142FB854966320FB',
  ],
])

const compatibilityShims = new Set([
  'packages/codex-session-surface/src/upstream/ChatMarkdown.tsx',
  'packages/codex-session-surface/src/upstream/t3code/MessageCopyButton.tsx',
  'packages/codex-session-surface/src/upstream/t3code/PierreEntryIcon.tsx',
  'packages/codex-session-surface/src/upstream/t3code/ProposedPlanCard.tsx',
  'packages/codex-session-surface/src/upstream/t3code/SkillInlineText.tsx',
  'packages/codex-session-surface/src/upstream/t3code/TerminalContextInlineChip.tsx',
  'packages/codex-session-surface/src/upstream/t3code/userMessageTerminalContexts.ts',
])

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  }))
  return files.flat()
}

const upstreamRoot = path.join(rootDir, 'packages', 'codex-session-surface', 'src', 'upstream')
const discoveredFiles = new Set((await listFiles(upstreamRoot)).map((filePath) => (
  path.relative(rootDir, filePath).split(path.sep).join('/')
)))
const classifiedFiles = new Set(
  [...pinnedFiles.keys(), ...compatibilityShims].filter((filePath) => filePath.startsWith(
    'packages/codex-session-surface/src/upstream/',
  )),
)
const unclassifiedFiles = [...discoveredFiles].filter((filePath) => !classifiedFiles.has(filePath))
const missingFiles = [...classifiedFiles].filter((filePath) => !discoveredFiles.has(filePath))

if (unclassifiedFiles.length > 0 || missingFiles.length > 0) {
  throw new Error([
    'The Codex session surface upstream manifest is incomplete.',
    unclassifiedFiles.length > 0 ? `Unclassified files: ${unclassifiedFiles.join(', ')}` : '',
    missingFiles.length > 0 ? `Missing files: ${missingFiles.join(', ')}` : '',
  ].filter(Boolean).join('\n'))
}

for (const [relativePath, expectedHash] of pinnedFiles) {
  const contents = await readFile(path.join(rootDir, relativePath))
  // Git may materialize these text files with CRLF when core.autocrlf is enabled.
  // Hash their canonical LF representation so checkout policy cannot look like
  // an upstream source change, while every other byte remains significant.
  const canonicalContents = contents.toString('utf8').replaceAll('\r\n', '\n')
  const actualHash = createHash('sha256').update(canonicalContents, 'utf8').digest('hex').toUpperCase()

  if (actualHash !== expectedHash) {
    throw new Error(
      `Vendored T3 Code file differs from the pinned upstream source: ${relativePath}\n` +
        `Expected SHA-256: ${expectedHash}\n` +
        `Actual SHA-256:   ${actualHash}`,
    )
  }
}

console.log(
  `Verified ${pinnedFiles.size} canonical T3 Code files and ` +
    `${compatibilityShims.size} explicitly classified compatibility shims.`,
)
