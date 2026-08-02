import { useEffect, useState } from 'react'
import { ToolLine } from '@mingcute/react'
import { AppButton } from '@/components/app-button'
import type { AgentInteractionRequest } from '@/features/agent/types'
import './styles.css'

type InteractionFieldAnswers = Record<string, string[]>

export function updateInteractionFieldSelection(
  current: InteractionFieldAnswers,
  fieldId: string,
  optionId: string,
  multiSelect: boolean,
): InteractionFieldAnswers {
  const selected = current[fieldId] ?? []
  const next = multiSelect
    ? selected.includes(optionId)
      ? selected.filter((value) => value !== optionId)
      : [...selected, optionId]
    : [optionId]
  return { ...current, [fieldId]: next }
}

export function buildInteractionFieldAnswers(
  fields: AgentInteractionRequest['fields'],
  selections: InteractionFieldAnswers,
  textAnswers: Record<string, string>,
) {
  return Object.fromEntries((fields ?? []).map((field) => {
    const text = textAnswers[field.id]?.trim()
    return [field.id, [...new Set([
      ...(selections[field.id] ?? []),
      ...(text ? [text] : []),
    ])]]
  }))
}

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
  const [fieldSelections, setFieldSelections] = useState<InteractionFieldAnswers>({})
  const [fieldTextAnswers, setFieldTextAnswers] = useState<Record<string, string>>({})
  const selectableOptions = request.options.filter((option) => option.id !== 'reject' && option.id !== 'deny')
  const fields = request.fields ?? []
  const needsTextAnswer = request.kind === 'question' && fields.length === 0 && selectableOptions.length === 0
  const resolvedFieldAnswers = buildInteractionFieldAnswers(fields, fieldSelections, fieldTextAnswers)
  const canSubmitFields = fields.length > 0
    && fields.every((field) => (resolvedFieldAnswers[field.id]?.length ?? 0) > 0)

  useEffect(() => {
    setAnswer('')
    setFieldSelections({})
    setFieldTextAnswers({})
  }, [request.id])

  return (
    <section className='agent-interaction-panel' aria-label={request.title} aria-live='polite'>
      <div className='agent-interaction-icon' aria-hidden='true'>
        <ToolLine />
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
              const selectedOptions = fieldSelections[field.id] ?? []
              const textAnswer = fieldTextAnswers[field.id] ?? ''
              return (
                <div className='agent-interaction-field' key={field.id}>
                  <div className='agent-interaction-field-copy'>
                    <strong>{field.label}</strong>
                    {field.message ? <span>{field.message}</span> : null}
                  </div>
                  {options.length > 0 ? (
                    <div
                      aria-label={field.label}
                      className='agent-interaction-field-options'
                      role='group'
                    >
                      {options.map((option) => (
                        <button
                          aria-pressed={selectedOptions.includes(option.id)}
                          className={`agent-interaction-field-option${selectedOptions.includes(option.id) ? ' is-selected' : ''}`}
                          key={option.id}
                          type='button'
                          onClick={() => {
                            setFieldSelections((current) => updateInteractionFieldSelection(
                              current,
                              field.id,
                              option.id,
                              field.multiSelect === true,
                            ))
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
                        autoComplete='off'
                        className='agent-interaction-input is-multiline'
                        name={field.id}
                        placeholder='输入回答…'
                        rows={4}
                        value={textAnswer}
                        onChange={(event) => {
                          setFieldTextAnswers((current) => ({ ...current, [field.id]: event.target.value }))
                        }}
                      />
                    ) : (
                      <input
                        aria-label={field.label}
                        autoComplete='off'
                        className='agent-interaction-input'
                        name={field.id}
                        placeholder='输入回答…'
                        type={field.isSecret ? 'password' : 'text'}
                        value={textAnswer}
                        onChange={(event) => {
                          setFieldTextAnswers((current) => ({ ...current, [field.id]: event.target.value }))
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
            autoComplete='off'
            className='agent-interaction-input'
            name='agent-question-answer'
            placeholder='输入回答…'
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
              void onRespond(request.id, 'answer', undefined, resolvedFieldAnswers)
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
