import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureMeoRuntimePatches, verifyMeoRuntimeLayout } from './meo-runtime-utils.mjs'

const currentFilePath = fileURLToPath(import.meta.url)
const projectRootPath = path.resolve(path.dirname(currentFilePath), '..')
const vendoredRuntimeRootPath = path.join(projectRootPath, 'vendor', 'meo-runtime')

await verifyMeoRuntimeLayout(vendoredRuntimeRootPath)
await ensureMeoRuntimePatches(vendoredRuntimeRootPath, { apply: true })

console.log(`Vendored MEO runtime patches verified: ${vendoredRuntimeRootPath}`)
