export type WorkspaceNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  children?: WorkspaceNode[]
}

export type WorkspaceChangeEvent = {
  rootPath: string
  path: string
  type: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'
}
