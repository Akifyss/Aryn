type WritingEditorProps = {
  disabled?: boolean
  value: string
  onChange: (nextValue: string) => void
}

export function WritingEditor({ disabled = false, onChange, value }: WritingEditorProps) {
  return (
    <textarea
      className='editor-surface'
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      placeholder='Open a file to start editing.'
      spellCheck={false}
      value={value}
    />
  )
}
