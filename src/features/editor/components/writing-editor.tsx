import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor"

type WritingEditorProps = {
  disabled?: boolean
  onCompositionChange?: (isComposing: boolean) => void
  value: string
  onChange: (nextValue: string) => void
  theme?: "light" | "dark" | "auto"
}

export function WritingEditor({
  disabled = false,
  onCompositionChange,
  onChange,
  value,
  theme = "auto"
}: WritingEditorProps) {
  return (
    <SimpleEditor
      disabled={disabled}
      onChange={onChange}
      onCompositionChange={onCompositionChange}
      value={value}
      theme={theme}
    />
  )
}
