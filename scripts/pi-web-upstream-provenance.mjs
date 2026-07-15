import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const PI_WEB_UPSTREAM_COMMIT = 'b3bcb4c58eec1c29704e7dbbad5d6904b36f05d7'
export const PI_WEB_UPSTREAM_TREE_SHA256 = '3387650cdfa2d503137ad58977c804428ad7eaccbae99c0423ee6eec4c22b952'

export const PI_WEB_UPSTREAM_FILE_HASHES = Object.freeze({
  'app/globals.css': '3454f19b772a68f5a4a05bfddfa53bb9a978c97024ee7471892d7efb432aa94e',
  'components/ChatWindow.tsx': '5a6b6a5561d11134ad3cab88cdc028cb188576551d7dede0330772b6947e8e41',
  'components/MarkdownBody.tsx': 'c3dd9eee6cc825e7ea6d63894b0ba24aab5929b00c45e5b3540fc97c3eb86b99',
  'components/MessageView.tsx': '2b3c19edf3880fe9a67e619709acf089edee5641c24d41e3231bdc93f6f130c3',
  'hooks/useAgentSession.ts': '2c8964d9f12b3fa43120f64296bf403c0cb2bf7522a201481a51590dca9c48d2',
  'hooks/useTheme.ts': '78743a2ad0814c8720a940cb4d6e07e464fbbca46151f54351aaafc5b424ba4a',
  'lib/clipboard.ts': '334812bee1b3951b61806aaa61aa23f78d94c8c48fe1158b18ae49c944b1b934',
  'lib/compaction-summary.ts': 'bac9b55ba17b4e26a1c0b4ab9c515b63ee9352d1d2e5f14e0fbef4934071a622',
  'lib/file-links.ts': 'ce8e728d17d165dc791c3be84640b79b792bee735c7dbaa66b6504f6d79f085c',
  'lib/markdown.ts': '74ecfe859b8d9eb447287efd1d4cae9546b7364a12d89432ddd7a18e75c53b98',
  'lib/message-display.ts': 'db367c71084c8b2812dff648a8244de971ac3b0812bdf7db353a7b0936dc38ec',
  'lib/normalize.ts': '4fb7dd7f876409578f47e137b005f5fcce90b5a92b00de93e846b3132a086a6f',
  'lib/patch.ts': 'f9f33dbf299c859054f361dbc6fd915366f07e7ec075a151110bd941b7090a80',
  'lib/session-reader.ts': 'cbf1254792a2f69e982225ef94eef9c255dac448739710c864b098f8a2eceb85',
  'lib/types.ts': 'e0db02cc944af7e1174808e1b2fd3a164ec2dcd9f923a9376ddccf8805928ab4',
})

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function listFiles(root, relativeDirectory = '') {
  const directory = path.join(root, ...relativeDirectory.split('/').filter(Boolean))
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name
    if (entry.isDirectory()) {
      files.push(...await listFiles(root, relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }
  return files.sort()
}

export async function verifyPiWebUpstreamProvenance(upstreamRoot) {
  const expectedFiles = Object.keys(PI_WEB_UPSTREAM_FILE_HASHES).sort()
  const actualFiles = await listFiles(upstreamRoot)
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    const missing = expectedFiles.filter((file) => !actualFiles.includes(file))
    const extra = actualFiles.filter((file) => !expectedFiles.includes(file))
    throw new Error(`Vendored pi-web file set diverged from ${PI_WEB_UPSTREAM_COMMIT}; missing=${missing.join(',') || 'none'}; extra=${extra.join(',') || 'none'}`)
  }

  const tree = createHash('sha256')
  for (const relativePath of actualFiles) {
    const source = await readFile(path.join(upstreamRoot, ...relativePath.split('/')))
    const actualHash = sha256(source)
    const expectedHash = PI_WEB_UPSTREAM_FILE_HASHES[relativePath]
    if (actualHash !== expectedHash) {
      throw new Error(`Vendored pi-web source diverged from ${PI_WEB_UPSTREAM_COMMIT}: ${relativePath}`)
    }
    tree.update(relativePath)
    tree.update('\0')
    tree.update(source)
    tree.update('\0')
  }

  const treeHash = tree.digest('hex')
  if (treeHash !== PI_WEB_UPSTREAM_TREE_SHA256) {
    throw new Error(`Vendored pi-web tree diverged from ${PI_WEB_UPSTREAM_COMMIT}: ${treeHash}`)
  }

  return { files: actualFiles, treeHash }
}
