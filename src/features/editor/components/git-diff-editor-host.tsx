import { EditorPlatformNotice } from '@/features/editor/components/editor-platform-notice'
import { GitDiffEditor, type GitDiffEditorProps } from '@/features/editor/components/git-diff-editor'
import { resolveDiffEngineChoice } from '@/features/editor/lib/editor-platform'
import { useSettingsStore } from '@/hooks/use-settings-store'

export function GitDiffEditorHost(props: GitDiffEditorProps) {
  const diffEngine = useSettingsStore((state) => state.diffEngine)
  const diffResolution = resolveDiffEngineChoice(diffEngine)
  const needsFallbackNotice = diffResolution.preferredId !== diffResolution.resolvedId

  return (
    <>
      {needsFallbackNotice ? (
        <EditorPlatformNotice
          title='当前 diff 引擎已回退到稳定方案。'
          detail={diffResolution.fallbackReason}
        />
      ) : null}
      <GitDiffEditor {...props} />
    </>
  )
}
