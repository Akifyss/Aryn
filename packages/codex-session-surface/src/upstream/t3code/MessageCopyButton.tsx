import { CheckIcon, CopyIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export function MessageCopyButton({ text }: { text: string; variant?: string }) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
  }, [])

  return (
    <button
      aria-label={copied ? 'Copied' : 'Copy message'}
      className='t3-button'
      onClick={() => {
        const request = navigator.clipboard?.writeText(text)
        if (!request) {
          setCopied(false)
          return
        }
        void request.then(() => {
          setCopied(true)
          if (resetTimerRef.current !== null) window.clearTimeout(resetTimerRef.current)
          resetTimerRef.current = window.setTimeout(() => {
            resetTimerRef.current = null
            setCopied(false)
          }, 1200)
        }).catch(() => setCopied(false))
      }}
      type='button'
    >
      {copied ? <CheckIcon className='size-3' /> : <CopyIcon className='size-3' />}
    </button>
  )
}
