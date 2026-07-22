import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { diffLines } from 'diff'
import type { GitFileDiffResult } from '@/features/git/types'
import './styles.css'

type MarkdownDiffSection =
  | {
    kind: 'unchanged'
    value: string
  }
  | {
    addedValue: string
    kind: 'replaced'
    removedValue: string
  }
  | {
    kind: 'added'
    value: string
  }
  | {
    kind: 'removed'
    value: string
  }

const MARKDOWN_PLUGINS = [remarkGfm]

function buildMarkdownDiffSections(originalContent: string, modifiedContent: string): MarkdownDiffSection[] {
  const parts = diffLines(originalContent, modifiedContent)
  const sections: MarkdownDiffSection[] = []

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]

    if (part.added) {
      sections.push({
        kind: 'added',
        value: part.value,
      })
      continue
    }

    if (part.removed) {
      const nextPart = parts[index + 1]

      if (nextPart?.added) {
        sections.push({
          addedValue: nextPart.value,
          kind: 'replaced',
          removedValue: part.value,
        })
        index += 1
        continue
      }

      sections.push({
        kind: 'removed',
        value: part.value,
      })
      continue
    }

    sections.push({
      kind: 'unchanged',
      value: part.value,
    })
  }

  return sections.filter((section) => {
    if (section.kind === 'replaced') {
      return section.removedValue.trim().length > 0 || section.addedValue.trim().length > 0
    }

    return section.value.trim().length > 0
  })
}

function MarkdownFragment({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ href, children }) => (
          <a href={href} rel='noreferrer' target='_blank'>
            {children}
          </a>
        ),
      }}
      remarkPlugins={MARKDOWN_PLUGINS}
    >
      {markdown}
    </ReactMarkdown>
  )
}

function MarkdownSection({
  accent,
  label,
  markdown,
}: {
  accent: 'added' | 'removed' | 'unchanged'
  label?: string
  markdown: string
}) {
  return (
    <section className={`markdown-diff-section markdown-diff-section-${accent}`}>
      {label ? <p className='markdown-diff-section-label'>{label}</p> : null}
      <div className='markdown-diff-markdown'>
        <MarkdownFragment markdown={markdown} />
      </div>
    </section>
  )
}

export function MarkdownDiffView({ diff }: { diff: GitFileDiffResult }) {
  const sections = buildMarkdownDiffSections(diff.originalContent, diff.modifiedContent)

  if (sections.length === 0) {
    return (
      <div className='markdown-diff-empty-state'>
        <p>No rendered Markdown changes are available for this file.</p>
      </div>
    )
  }

  return (
    <div className='markdown-diff-view'>
      {sections.map((section, index) => {
        if (section.kind === 'unchanged') {
          return (
            <MarkdownSection
              key={`unchanged-${index}`}
              accent='unchanged'
              markdown={section.value}
            />
          )
        }

        if (section.kind === 'added') {
          return (
            <MarkdownSection
              key={`added-${index}`}
              accent='added'
              label='Added'
              markdown={section.value}
            />
          )
        }

        if (section.kind === 'removed') {
          return (
            <MarkdownSection
              key={`removed-${index}`}
              accent='removed'
              label='Removed'
              markdown={section.value}
            />
          )
        }

        return (
          <div className='markdown-diff-replaced-group' key={`replaced-${index}`}>
            <MarkdownSection
              accent='removed'
              label='Removed'
              markdown={section.removedValue}
            />
            <MarkdownSection
              accent='added'
              label='Added'
              markdown={section.addedValue}
            />
          </div>
        )
      })}
    </div>
  )
}
