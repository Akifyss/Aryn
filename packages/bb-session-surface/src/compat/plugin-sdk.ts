export type ThreadChatMessageReference = {
  id: string
  role: 'assistant' | 'user'
  sourceSeqEnd: number
  text: string
  threadId: string
}

export type BbNavigate = {
  openThreadPanel: (options: {
    actionId: string
    title?: string
    params?: unknown
  }) => boolean
}

export type PluginMessageDirectiveMessage = {
  id: string
  projectId: string | null
  threadId: string
  turnId: string | null
}

export type PluginMessageDirectiveProps = {
  attributes: Readonly<Record<string, string>>
  message: PluginMessageDirectiveMessage
  openWorkspaceFile: ((path: string) => boolean) | null
  source: string
}
