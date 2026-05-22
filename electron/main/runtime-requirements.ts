export const PI_AGENT_MINIMUM_NODE_VERSION = '22.19.0'

function readVersionParts(version: string) {
  const [major = '0', minor = '0', patch = '0'] = version.split('.')

  return [
    Number.parseInt(major, 10) || 0,
    Number.parseInt(minor, 10) || 0,
    Number.parseInt(patch, 10) || 0,
  ] as const
}

export function isNodeVersionAtLeast(version: string, minimumVersion = PI_AGENT_MINIMUM_NODE_VERSION) {
  const current = readVersionParts(version)
  const minimum = readVersionParts(minimumVersion)

  for (let index = 0; index < minimum.length; index += 1) {
    if (current[index] > minimum[index]) {
      return true
    }

    if (current[index] < minimum[index]) {
      return false
    }
  }

  return true
}

export function assertPiAgentRuntimeCompatible(nodeVersion = process.versions.node) {
  if (isNodeVersionAtLeast(nodeVersion)) {
    return
  }

  throw new Error([
    `Aryn requires Electron's embedded Node.js runtime to be >= ${PI_AGENT_MINIMUM_NODE_VERSION}.`,
    '@earendil-works/pi-coding-agent 0.75.x depends on Node APIs used by undici 8.x.',
    `Current embedded Node.js runtime is ${nodeVersion}.`,
    'Upgrade Electron with Pi, or pin Pi to a version compatible with the older Electron runtime.',
  ].join(' '))
}
