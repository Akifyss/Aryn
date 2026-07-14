export const OPENCODE_PROTOCOL_VERSION = '1.17.18'

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
  const expected = parseOpenCodeVersion(OPENCODE_PROTOCOL_VERSION)
  return actual !== null
    && expected !== null
    && actual.major === expected.major
    && actual.minor === expected.minor
}

export function formatOpenCodeVersionCompatibilityError(value: string | null | undefined) {
  const actual = value?.trim() || '未知版本'
  return `当前 OpenCode CLI（${actual}）与 Aryn 支持的协议版本 ${OPENCODE_PROTOCOL_VERSION} 不兼容；请安装 ${OPENCODE_PROTOCOL_VERSION} 同一 minor 系列的版本。`
}
