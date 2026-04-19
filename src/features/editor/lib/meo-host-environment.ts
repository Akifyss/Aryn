export type MeoHostAppApi = Pick<
  Window['appApi'],
  'getGitBaseline' | 'getGitLineBlame' | 'saveWorkspaceImage' | 'workspaceFileExists'
>

export type MeoHostEnvironment = {
  appApi: MeoHostAppApi
  openExternalLink: (href: string) => void
}

export function createDefaultMeoHostEnvironment(): MeoHostEnvironment {
  return {
    appApi: window.appApi,
    openExternalLink: (href) => {
      window.open(href, '_blank', 'noopener,noreferrer')
    },
  }
}
