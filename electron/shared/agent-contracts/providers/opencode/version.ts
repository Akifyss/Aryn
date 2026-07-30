export const OPENCODE_MINIMUM_VERSION = '1.17.18'
export const OPENCODE_SUPPORTED_MAJOR = 1
export const OPENCODE_COMPATIBLE_VERSION_RANGE = `>=${OPENCODE_MINIMUM_VERSION} <${OPENCODE_SUPPORTED_MAJOR + 1}.0.0`

type OpenCodeVersion = {
  major: number
  minor: number
  patch: number
}

export function parseOpenCodeVersion(value: string | null | undefined): OpenCodeVersion | null {
  if (!value) return null
  const match = value.match(/(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:[^\d]|$)/)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

export function isCompatibleOpenCodeVersion(value: string | null | undefined) {
  const actual = parseOpenCodeVersion(value)
  const minimum = parseOpenCodeVersion(OPENCODE_MINIMUM_VERSION)
  return actual !== null
    && minimum !== null
    && actual.major === OPENCODE_SUPPORTED_MAJOR
    && (
      actual.minor > minimum.minor
      || (actual.minor === minimum.minor && actual.patch >= minimum.patch)
    )
}

export function formatOpenCodeVersionCompatibilityError(value: string | null | undefined) {
  const actual = value?.trim() || '未知版本'
  return `当前 OpenCode CLI（${actual}）不在 Aryn 支持的协议范围 ${OPENCODE_COMPATIBLE_VERSION_RANGE} 内。`
}
