export function FileDiff({ fileDiff }: { fileDiff: unknown; options?: unknown }) {
  return <pre className='overflow-x-auto rounded-md bg-muted/40 p-2 text-xs'>{String(fileDiff)}</pre>
}
