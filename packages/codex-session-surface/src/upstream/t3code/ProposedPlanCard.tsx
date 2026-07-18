import ChatMarkdown from '../ChatMarkdown'

export function ProposedPlanCard({ planMarkdown }: { planMarkdown: string; [key: string]: unknown }) {
  return (
    <section className='rounded-lg border border-border bg-card p-3'>
      <p className='mb-2 text-xs font-medium text-muted-foreground'>Plan</p>
      <ChatMarkdown text={planMarkdown} />
    </section>
  )
}
