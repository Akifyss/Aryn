import { SimpleEditor } from "@/components/tiptap-templates/simple/simple-editor"

type WritingEditorProps = {
  disabled?: boolean
  value: string
  onChange: (nextValue: string) => void
}

export function WritingEditor({
  disabled = false,
  onChange,
  value,
}: WritingEditorProps) {
  return <SimpleEditor disabled={disabled} onChange={onChange} value={value} />
}
