export type WorkspaceNode = {
  name: string
  path: string
  kind: 'directory' | 'file'
  isOpenable?: boolean
  hasChildren?: boolean
  size?: number
  createdAt?: string
  updatedAt?: string
  children?: WorkspaceNode[]
}

export type WorkspaceFileSystemView = 'icons' | 'list' | 'columns' | 'gallery'

export type WorkspaceFileSystemNavigationState = {
  index: number
  stack: string[]
}

export type WorkspaceFileSystemState = {
  navigation: WorkspaceFileSystemNavigationState | null
  selectedPath: string | null
  view: WorkspaceFileSystemView
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
export type WorkspaceIconThemeMode = 'light' | 'dark'

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

export type WorkspaceIconThemeSelection = {
  sourceVsixPath: string | null
  themeId: string | null
}

export type WorkspaceIconThemesByMode = Record<WorkspaceIconThemeMode, WorkspaceIconTheme | null>

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
