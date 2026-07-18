import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type Props = {
  className?: string
  cwd?: string
  isStreaming?: boolean
  lineBreaks?: boolean
  skills?: ReadonlyArray<unknown>
  text: string
  threadRef?: unknown
}

export default memo(function ChatMarkdown({ className, lineBreaks, text }: Props) {
  return (
    <div className={`t3-chat-markdown${lineBreaks ? ' whitespace-pre-wrap' : ''}${className ? ` ${className}` : ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
})
