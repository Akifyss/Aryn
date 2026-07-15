import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PI_WEB_UPSTREAM_COMMIT,
  PI_WEB_UPSTREAM_FILE_HASHES,
  PI_WEB_UPSTREAM_TREE_SHA256,
  verifyPiWebUpstreamProvenance,
} from '../scripts/pi-web-upstream-provenance.mjs'

const packageRoot = path.resolve('packages/pi-web-session-surface')
const upstreamRoot = path.join(packageRoot, 'src', 'upstream', 'pi-web')

describe('vendored pi-web upstream provenance', () => {
  it('contains exactly the pinned upstream source bytes', async () => {
    const result = await verifyPiWebUpstreamProvenance(upstreamRoot)

    expect(result.files).toHaveLength(15)
    expect(result.files).toEqual(Object.keys(PI_WEB_UPSTREAM_FILE_HASHES).sort())
    expect(result.treeHash).toBe(PI_WEB_UPSTREAM_TREE_SHA256)
  })

  it('documents the exact upstream commit represented by the source tree', async () => {
    const upstreamNotice = await readFile(path.join(packageRoot, 'UPSTREAM.md'), 'utf8')

    expect(upstreamNotice).toContain(PI_WEB_UPSTREAM_COMMIT)
  })
})
