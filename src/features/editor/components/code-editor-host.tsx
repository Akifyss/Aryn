import { CodeEditor, type CodeEditorProps } from '@/features/editor/components/code-editor'
import { EditorPlatformNotice } from '@/features/editor/components/editor-platform-notice'
import { resolveEditorRuntimeChoice } from '@/features/editor/lib/editor-platform'
import { useSettingsStore } from '@/hooks/use-settings-store'

export function CodeEditorHost(props: CodeEditorProps) {
  const editorRuntime = useSettingsStore((state) => state.editorRuntime)
  const runtimeResolution = resolveEditorRuntimeChoice(editorRuntime)
  const needsFallbackNotice = runtimeResolution.preferredId !== runtimeResolution.resolvedId

  return (
    <>
      {needsFallbackNotice ? (
        <EditorPlatformNotice
          title='当前编辑器运行时已回退到稳定方案。'
          detail={runtimeResolution.fallbackReason}
        />
      ) : null}
      <CodeEditor {...props} />
    </>
  )
}
