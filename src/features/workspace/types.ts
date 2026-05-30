export type WorkspaceNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  isOpenable?: boolean
  children?: WorkspaceNode[]
}

export type WorkspaceChangeEvent = {
  rootPath: string
  path: string
  type: 'add' | 'addDir' | 'change' | 'unlink' | 'unlinkDir'
}

export type WorkspaceIconThemeOption = {
  id: string
  label: string
}

export type WorkspaceIconThemeSourceKind = 'bundled' | 'external'

export type WorkspaceIconThemeCatalogOption = {
  key: string
  label: string
  sourceKind: WorkspaceIconThemeSourceKind
  sourceVsixPath: string
  themeId: string
}

export type WorkspaceIconTheme = {
  activeThemeId: string
  activeThemeLabel: string
  defaultFileIcon: string | null
  defaultFolderExpandedIcon: string | null
  defaultFolderIcon: string | null
  defaultRootFolderExpandedIcon: string | null
  defaultRootFolderIcon: string | null
  extensionLabel: string
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  folderNames: Record<string, string>
  folderNamesExpanded: Record<string, string>
  sourceKind: WorkspaceIconThemeSourceKind
  sourceVsixPath: string
  themes: WorkspaceIconThemeOption[]
}

export type ProjectRecord = {
  id: string
  name: string
  path: string
  addedAt: string
  lastOpenedAt: string
  lastFilePath: string | null
}

export type ProjectState = {
  lastProjectId: string | null
  projects: ProjectRecord[]
}
