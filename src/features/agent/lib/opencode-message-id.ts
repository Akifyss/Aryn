const OPEN_CODE_ID_RANDOM_LENGTH = 14
const OPEN_CODE_ID_TIME_HEX_LENGTH = 12
const OPEN_CODE_BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

let lastTimestamp = 0
let counter = 0

function createOpenCodeIdentifier(prefix: 'msg' | 'prt') {
  const timestamp = Date.now()
  if (timestamp !== lastTimestamp) {
    lastTimestamp = timestamp
    counter = 0
  }
  counter += 1

  const encodedTime = BigInt(timestamp) * 0x1000n + BigInt(counter)
  const timeHex = encodedTime
    .toString(16)
    .padStart(OPEN_CODE_ID_TIME_HEX_LENGTH, '0')
    .slice(-OPEN_CODE_ID_TIME_HEX_LENGTH)
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(OPEN_CODE_ID_RANDOM_LENGTH))
  const random = Array.from(bytes, (value) => OPEN_CODE_BASE62[value % OPEN_CODE_BASE62.length]).join('')
  return `${prefix}_${timeHex}${random}`
}

export function createOpenCodeMessageId() {
  return createOpenCodeIdentifier('msg')
}

export function createOpenCodePartId() {
  return createOpenCodeIdentifier('prt')
}

export function isOpenCodeMessageId(value: unknown): value is string {
  return typeof value === 'string' && /^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(value)
}

export function isOpenCodePartId(value: unknown): value is string {
  return typeof value === 'string' && /^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/.test(value)
}
