import { useEffect, useRef, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import {
  CornerUpLeftLine,
  Delete2Line,
  EditLine,
  More1Line,
} from '@mingcute/react'
import { AppTooltip, AppTooltipButton } from '@/components/app-tooltip'
import type {
  AgentQueuedMessageKind,
  AgentQueuedMessageUpdate,
} from '@/features/agent/types'
import { shouldCloseClickOpenedMenu } from '@/lib/base-ui-menu'
import './styles.css'

export type AgentQueuedComposerMessage = {
  id: string
  index: number
  kind: AgentQueuedMessageKind
  text: string
}

type AgentQueuedComposerTrayProps = {
  canUpdate: boolean
  menuPortalTarget?: HTMLElement | null
  messages: readonly AgentQueuedComposerMessage[]
  onUpdate: (update: AgentQueuedMessageUpdate) => Promise<void>
}

export function AgentQueuedComposerTray({
  canUpdate,
  menuPortalTarget,
  messages,
  onUpdate,
}: AgentQueuedComposerTrayProps) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [openMenuMessageId, setOpenMenuMessageId] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const editingInputRef = useRef<HTMLInputElement | null>(null)
  const updateInFlightRef = useRef(false)
  const canRenderMenuPortal = menuPortalTarget !== null

  useEffect(() => {
    if (!editingMessageId) {
      return
    }

    if (canUpdate && messages.some((message) => message.id === editingMessageId)) {
      return
    }

    setEditingMessageId(null)
    setEditingText('')
  }, [canUpdate, editingMessageId, messages])

  useEffect(() => {
    if (!openMenuMessageId) {
      return
    }

    if (canUpdate && messages.some((message) => message.id === openMenuMessageId)) {
      return
    }

    setOpenMenuMessageId(null)
  }, [canUpdate, messages, openMenuMessageId])

  useEffect(() => {
    if (!editingMessageId) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      editingInputRef.current?.focus()
      editingInputRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [editingMessageId])

  if (messages.length === 0) {
    return null
  }

  function beginEdit(message: AgentQueuedComposerMessage) {
    setOpenMenuMessageId(null)
    setEditingMessageId(message.id)
    setEditingText(message.text)
  }

  function cancelEdit() {
    setEditingMessageId(null)
    setEditingText('')
  }

  async function runUpdate(update: AgentQueuedMessageUpdate) {
    if (!canUpdate || updateInFlightRef.current) {
      return
    }

    updateInFlightRef.current = true
    setIsUpdating(true)

    try {
      await onUpdate(update)
      if (update.action === 'edit') {
        cancelEdit()
      }
      setOpenMenuMessageId(null)
    } catch {
      // Parent state owns the visible error; keep the row open so the user can retry.
    } finally {
      updateInFlightRef.current = false
      setIsUpdating(false)
    }
  }

  async function saveEdit(message: AgentQueuedComposerMessage) {
    const nextText = editingText.trim()

    if (!nextText || nextText === message.text) {
      cancelEdit()
      return
    }

    await runUpdate({
      action: 'edit',
      expectedText: message.text,
      index: message.index,
      kind: message.kind,
      text: nextText,
    })
  }

  return (
    <section
      className='agent-queued-tray'
      aria-busy={isUpdating || undefined}
      aria-label='待处理的 Agent 消息'
    >
      {messages.map((message) => {
        const isEditing = canUpdate && editingMessageId === message.id
        const isMenuOpen = openMenuMessageId === message.id
        const isFollowUp = message.kind === 'followUp'
        const targetKind = isFollowUp ? 'steer' : 'followUp'

        return (
          <div
            key={message.id}
            className={`agent-queued-row agent-queued-row-${message.kind}${isEditing ? ' is-editing' : ''}`}
          >
            <div className='agent-queued-row-leading' aria-hidden='true'>
              <span className='agent-queued-row-grip'>::</span>
              <CornerUpLeftLine size={16} />
            </div>

            <div className='agent-queued-row-main'>
              <span className={`agent-queued-kind agent-queued-kind-${message.kind}`}>
                {isFollowUp ? '排队' : '引导'}
              </span>
              {isEditing ? (
                <input
                  ref={editingInputRef}
                  className='agent-queued-edit-input'
                  value={editingText}
                  disabled={isUpdating}
                  aria-label='编辑待处理消息'
                  onChange={(event) => {
                    setEditingText(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelEdit()
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveEdit(message)
                    }
                  }}
                />
              ) : (
                <AppTooltip
                  excludeFromTabOrder
                  tooltip={message.text}
                  triggerClassName='agent-queued-text'
                  triggerRole='note'
                >
                  <span>
                    {message.text}
                  </span>
                </AppTooltip>
              )}
            </div>

            {canUpdate ? (
              <div className='agent-queued-actions'>
                {isEditing ? (
                  <>
                    <button
                      type='button'
                      className='agent-queued-action is-text'
                      disabled={isUpdating || !editingText.trim()}
                      onClick={() => {
                        void saveEdit(message)
                      }}
                    >
                      保存
                    </button>
                    <button
                      type='button'
                      className='agent-queued-action is-text'
                      disabled={isUpdating}
                      onClick={cancelEdit}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <AppTooltipButton
                      type='button'
                      className='agent-queued-action is-text'
                      disabled={isUpdating}
                      onClick={() => {
                        void runUpdate({
                          action: 'move',
                          expectedText: message.text,
                          index: message.index,
                          kind: message.kind,
                          targetKind,
                        })
                      }}
                    >
                      {isFollowUp ? '引导' : '排队'}
                    </AppTooltipButton>
                    <AppTooltipButton
                      type='button'
                      className='agent-queued-action'
                      disabled={isUpdating}
                      aria-label='删除待处理消息'
                      tooltip='删除'
                      onClick={() => {
                        void runUpdate({
                          action: 'delete',
                          expectedText: message.text,
                          index: message.index,
                          kind: message.kind,
                        })
                      }}
                    >
                      <Delete2Line size={16} />
                    </AppTooltipButton>
                    <Menu.Root
                      modal={false}
                      open={isMenuOpen}
                      onOpenChange={(open, details) => {
                        if (open) {
                          setOpenMenuMessageId(message.id)
                          return
                        }

                        if (shouldCloseClickOpenedMenu(details)) {
                          setOpenMenuMessageId((currentValue) => (
                            currentValue === message.id ? null : currentValue
                          ))
                        } else {
                          details.cancel()
                        }
                      }}
                    >
                      <div className='agent-queued-menu-anchor'>
                        <Menu.Trigger
                          className='agent-queued-action'
                          disabled={isUpdating}
                          aria-label='更多待处理消息操作'
                          render={<AppTooltipButton tooltip='更多' />}
                        >
                          <More1Line size={16} />
                        </Menu.Trigger>
                        {canRenderMenuPortal ? (
                          <Menu.Portal container={menuPortalTarget ?? undefined}>
                            <Menu.Positioner
                              align='end'
                              className='agent-queued-menu-positioner'
                              collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
                              collisionPadding={8}
                              positionMethod='fixed'
                              side='bottom'
                              sideOffset={6}
                            >
                              <Menu.Popup className='agent-queued-menu' finalFocus={false}>
                                <Menu.Item
                                  nativeButton
                                  className={({ highlighted }) => (
                                    `agent-queued-menu-item${highlighted ? ' is-highlighted' : ''}`
                                  )}
                                  label='编辑消息'
                                  render={<button type='button' />}
                                  onClick={() => {
                                    beginEdit(message)
                                  }}
                                >
                                  <EditLine size={16} />
                                  <span>编辑消息</span>
                                </Menu.Item>
                                <Menu.Item
                                  nativeButton
                                  className={({ highlighted }) => (
                                    `agent-queued-menu-item${highlighted ? ' is-highlighted' : ''}`
                                  )}
                                  label={`关闭${isFollowUp ? '排队' : '引导'}`}
                                  render={<button type='button' />}
                                  onClick={() => {
                                    void runUpdate({
                                      action: 'delete',
                                      expectedText: message.text,
                                      index: message.index,
                                      kind: message.kind,
                                    })
                                  }}
                                >
                                  <CornerUpLeftLine size={16} />
                                  <span>关闭{isFollowUp ? '排队' : '引导'}</span>
                                </Menu.Item>
                              </Menu.Popup>
                            </Menu.Positioner>
                          </Menu.Portal>
                        ) : null}
                      </div>
                    </Menu.Root>
                  </>
                )}
              </div>
            ) : null}
          </div>
        )
      })}
    </section>
  )
}
