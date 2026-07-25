import { useEffect, useState } from 'react'
import { ToolLine } from '@mingcute/react'
import { AppButton } from '@/components/app-button'
import type { AgentInteractionRequest } from '@/features/agent/types'
import './styles.css'

type AgentInteractionPanelProps = {
  onRespond: (
    requestId: string,
    optionId: string,
    values?: string[],
    answers?: Record<string, string[]>,
  ) => Promise<void>
  request: AgentInteractionRequest
}

export function AgentInteractionPanel({
  onRespond,
  request,
}: AgentInteractionPanelProps) {
  const [answer, setAnswer] = useState('')
  const [fieldAnswers, setFieldAnswers] = useState<Record<string, string>>({})
  const selectableOptions = request.options.filter((option) => option.id !== 'reject' && option.id !== 'deny')
  const fields = request.fields ?? []
  const needsTextAnswer = request.kind === 'question' && fields.length === 0 && selectableOptions.length === 0
  const canSubmitFields = fields.length > 0 && fields.every((field) => Boolean(fieldAnswers[field.id]?.trim()))

  useEffect(() => {
    setAnswer('')
    setFieldAnswers({})
  }, [request.id])

  return (
    <section className='agent-interaction-panel' aria-label={request.title} aria-live='polite'>
      <div className='agent-interaction-icon' aria-hidden='true'>
        <ToolLine size={17} />
      </div>
      <div className='agent-interaction-copy'>
        <strong>{request.title}</strong>
        <span>{request.message}</span>
      </div>
      <div className='agent-interaction-actions'>
        {fields.length > 0 ? (
          <div className='agent-interaction-fields'>
            {fields.map((field) => {
              const options = field.options ?? []
              const selectedAnswer = fieldAnswers[field.id] ?? ''
              return (
                <div className='agent-interaction-field' key={field.id}>
                  <div className='agent-interaction-field-copy'>
                    <strong>{field.label}</strong>
                    {field.message ? <span>{field.message}</span> : null}
                  </div>
                  {options.length > 0 ? (
                    <div className='agent-interaction-field-options'>
                      {options.map((option) => (
                        <button
                          aria-pressed={selectedAnswer === option.label}
                          className={`agent-interaction-field-option${selectedAnswer === option.label ? ' is-selected' : ''}`}
                          key={option.id}
                          type='button'
                          onClick={() => {
                            setFieldAnswers((current) => ({ ...current, [field.id]: option.label }))
                          }}
                        >
                          <span>{option.label}</span>
                          {option.description ? <small>{option.description}</small> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {(options.length === 0 || field.allowsCustomAnswer) ? (
                    field.multiline ? (
                      <textarea
                        aria-label={field.label}
                        className='agent-interaction-input is-multiline'
                        placeholder='输入回答'
                        rows={4}
                        value={selectedAnswer}
                        onChange={(event) => {
                          setFieldAnswers((current) => ({ ...current, [field.id]: event.target.value }))
                        }}
                      />
                    ) : (
                      <input
                        aria-label={field.label}
                        className='agent-interaction-input'
                        placeholder='输入回答'
                        type={field.isSecret ? 'password' : 'text'}
                        value={selectedAnswer}
                        onChange={(event) => {
                          setFieldAnswers((current) => ({ ...current, [field.id]: event.target.value }))
                        }}
                      />
                    )
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
        {needsTextAnswer ? (
          <input
            aria-label='回答 Agent 问题'
            className='agent-interaction-input'
            placeholder='输入回答'
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && answer.trim()) {
                event.preventDefault()
                void onRespond(request.id, 'answer', [answer.trim()])
              }
            }}
          />
        ) : null}
        {request.options.map((option) => (
          <AppButton
            key={option.id}
            variant={option.id.startsWith('allow') ? 'primary' : 'outline'}
            onClick={() => {
              void onRespond(request.id, option.id)
            }}
          >
            {option.label}
          </AppButton>
        ))}
        {fields.length > 0 ? (
          <AppButton
            variant='primary'
            disabled={!canSubmitFields}
            onClick={() => {
              const answers = Object.fromEntries(fields.map((field) => [field.id, [fieldAnswers[field.id].trim()]]))
              void onRespond(request.id, 'answer', undefined, answers)
            }}
          >
            提交
          </AppButton>
        ) : null}
        {needsTextAnswer ? (
          <AppButton
            variant='primary'
            disabled={!answer.trim()}
            onClick={() => {
              void onRespond(request.id, 'answer', [answer.trim()])
            }}
          >
            提交
          </AppButton>
        ) : null}
      </div>
    </section>
  )
}
