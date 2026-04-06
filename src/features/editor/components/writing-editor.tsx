import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor"

type WritingEditorProps = {
  disabled?: boolean
  value: string
  onChange: (nextValue: string) => void
  theme?: "light" | "dark" | "auto"
}

export function WritingEditor({
  disabled = false,
  onChange,
  value,
  theme = "auto"
}: WritingEditorProps) {
  return <SimpleEditor disabled={disabled} onChange={onChange} value={value} theme={theme} />
}
