export function TerminalContextInlineChip({ label, tooltipText }: { label: string; tooltipText: string }) {
  return <span className='rounded border border-border px-1.5 py-0.5 text-xs' title={tooltipText}>{label}</span>
}
