export type ThreadMentionResolution = {
  label: string
  projectId: string
  threadId: string
}

export const sdk = {
  threads: {
    async resolveMentions(_options: {
      signal?: AbortSignal
      threadIds: readonly string[]
    }): Promise<ThreadMentionResolution[]> {
      // Aryn does not run bb's HTTP thread service. Known Aryn thread mentions
      // are supplied through host metadata; unknown ids remain literal text.
      return []
    },
  },
}
