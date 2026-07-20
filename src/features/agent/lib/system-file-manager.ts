export function getSystemFileManagerName(platform: NodeJS.Platform) {
  if (platform === 'darwin') {
    return '访达'
  }

  if (platform === 'win32') {
    return '资源管理器'
  }

  return '文件管理器'
}
