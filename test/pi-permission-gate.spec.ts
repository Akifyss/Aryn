import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import arynPermissionGate from '../resources/agent-extensions/pi-permission-gate.mjs'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function createGateHarness() {
  const root = await mkdtemp(path.join(tmpdir(), 'aryn-pi-permission-'))
  tempRoots.push(root)
  const workspace = path.join(root, 'workspace')
  await mkdir(workspace)
  const confirm = vi.fn(async () => false)
  let handler: ((event: any, context: any) => Promise<unknown>) | null = null
  arynPermissionGate({
    on: (_event: string, nextHandler: typeof handler) => {
      handler = nextHandler
    },
  })
  return { confirm, getHandler: () => handler!, root, workspace }
}

describe('PI permission gate', () => {
  it('is copied into the packaged Electron resources', async () => {
    const builderConfig = JSON.parse(
      await readFile(new URL('../electron-builder.json', import.meta.url), 'utf8'),
    ) as { extraResources?: Array<{ from?: string, to?: string }> }

    expect(builderConfig.extraResources).toContainEqual({
      from: 'resources/agent-extensions',
      to: 'agent-extensions',
    })
  })

  it('allows existing workspace reads but asks for missing or outside read targets', async () => {
    const { confirm, getHandler, root, workspace } = await createGateHarness()
    await writeFile(path.join(workspace, 'inside.txt'), 'inside')
    await writeFile(path.join(root, 'outside.txt'), 'outside')
    const context = { cwd: workspace, ui: { confirm } }

    await getHandler()({ input: { path: 'inside.txt' }, toolName: 'read' }, context)
    expect(confirm).not.toHaveBeenCalled()

    await expect(getHandler()({ input: {}, toolName: 'read' }, context)).resolves.toEqual({
      block: true,
      reason: 'User denied this tool request in Aryn.',
    })
    await getHandler()({ input: { path: '../outside.txt' }, toolName: 'read' }, context)
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('does not treat a workspace symlink to an outside directory as an internal read', async () => {
    const { confirm, getHandler, root, workspace } = await createGateHarness()
    const outside = path.join(root, 'outside')
    await mkdir(outside)
    await writeFile(path.join(outside, 'secret.txt'), 'secret')
    const linkPath = path.join(workspace, 'linked-outside')
    await symlink(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir')

    await getHandler()({ input: { path: path.join('linked-outside', 'secret.txt') }, toolName: 'read' }, {
      cwd: workspace,
      ui: { confirm },
    })

    expect(confirm).toHaveBeenCalledOnce()
  })
})
