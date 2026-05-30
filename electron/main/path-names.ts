const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function ensureUsableFolderName(value: string, fallback: string) {
  const folderName = value.trim() || fallback
  return WINDOWS_RESERVED_FILE_NAME.test(folderName) ? `${folderName}-folder` : folderName
}
