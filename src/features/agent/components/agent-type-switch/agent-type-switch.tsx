import { useId } from 'react'
import { Menu } from '@base-ui/react/menu'
import { CheckLine, WarningLine } from '@mingcute/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import {
  DEFAULT_AGENT_ID,
  getAgentDefinition,
  type AgentAvailability,
  type AgentId,
} from '@/features/agent/agent-definition'
import { AgentBrandIcon } from '@/features/agent/components/agent-brand-icon/agent-brand-icon'
import './styles.css'

type AgentTypeSwitchProps = {
  agentCatalog: readonly AgentAvailability[]
  isLocked: boolean
  menuPortalTarget?: HTMLElement | null
  onRefresh: () => Promise<void>
  onSelect: (agentId: AgentId) => void
  refreshError: string | null
  selectedAgentId: AgentId
}

export function AgentTypeSwitchOptionCopy({
  availability,
  guidanceId,
  reasonId,
}: {
  availability: AgentAvailability
  guidanceId?: string
  reasonId?: string
}) {
  return (
    <span className='agent-type-switch-option-copy'>
      <span className='agent-type-switch-option-title'>
        {availability.definition.label}
      </span>
      {!availability.available ? (
        <>
          <span id={reasonId} className='agent-type-switch-option-description'>
            {availability.reason ?? '当前不可用'}
          </span>
          {availability.guidance ? (
            <span id={guidanceId} className='agent-type-switch-option-guidance'>
              {availability.guidance}
            </span>
          ) : null}
        </>
      ) : null}
    </span>
  )
}

export function AgentTypeSwitch({
  agentCatalog,
  isLocked,
  menuPortalTarget,
  onRefresh,
  onSelect,
  refreshError,
  selectedAgentId,
}: AgentTypeSwitchProps) {
  const descriptionIdPrefix = useId()
  const catalog = agentCatalog.length > 0
    ? agentCatalog
    : [{
        available: true,
        command: null,
        definition: getAgentDefinition(DEFAULT_AGENT_ID),
        guidance: null,
        reason: null,
        version: null,
      }]
  const selectedAvailability = catalog.find((item) => item.definition.id === selectedAgentId) ?? null
  const selectedDefinition = selectedAvailability?.definition ?? getAgentDefinition(selectedAgentId)

  return (
    <Menu.Root
      modal={false}
      onOpenChange={(open) => {
        if (open) void onRefresh()
      }}
    >
      <Menu.Trigger
        aria-label={`选择 Agent，当前：${selectedDefinition.label}`}
        className='agent-type-switch-trigger'
        disabled={isLocked}
        render={<button type='button' />}
      >
        <AgentBrandIcon agentId={selectedAgentId} className='agent-brand-icon' size={24} />
        <span className='agent-type-switch-label'>{selectedDefinition.label}</span>
      </Menu.Trigger>
      <Menu.Portal container={menuPortalTarget ?? undefined}>
        <Menu.Positioner
          align='start'
          className='agent-type-switch-menu-positioner'
          collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
          collisionPadding={8}
          positionMethod='fixed'
          side='bottom'
          sideOffset={6}
        >
          <Menu.Popup className='agent-type-switch-menu' aria-label='选择用于新会话的 Agent'>
            <AppScrollArea
              className='agent-type-switch-options-scroll'
              contentClassName='agent-type-switch-options-content'
              viewportClassName='agent-type-switch-options-viewport'
            >
              <Menu.RadioGroup
                value={selectedAgentId}
                onValueChange={(nextAgentId, eventDetails) => {
                  const availability = catalog.find((item) => item.definition.id === nextAgentId)
                  if (!availability?.available) {
                    eventDetails.cancel()
                    return
                  }
                  onSelect(availability.definition.id)
                }}
              >
                {catalog.map((availability) => {
                  const agentId = availability.definition.id
                  const isSelected = agentId === selectedAgentId
                  const isUnavailable = !availability.available
                  const reasonId = `${descriptionIdPrefix}-${agentId}-reason`
                  const guidanceId = availability.guidance
                    ? `${descriptionIdPrefix}-${agentId}-guidance`
                    : undefined

                  return (
                    <Menu.RadioItem
                      key={agentId}
                      nativeButton
                      aria-describedby={isUnavailable
                        ? [reasonId, guidanceId].filter(Boolean).join(' ')
                        : undefined}
                      aria-disabled={isUnavailable || undefined}
                      className={({ highlighted }) => (
                        `agent-type-switch-option${highlighted ? ' is-highlighted' : ''}${isSelected ? ' is-selected' : ''}${isUnavailable ? ' is-unavailable' : ''}`
                      )}
                      closeOnClick={!isUnavailable}
                      label={availability.definition.label}
                      render={<button type='button' />}
                      value={agentId}
                      onClick={(event) => {
                        if (isUnavailable) {
                          event.preventDefault()
                        }
                      }}
                    >
                      <span className='agent-type-switch-option-icon'>
                        <AgentBrandIcon
                          agentId={agentId}
                          className='agent-brand-icon'
                          size={16}
                        />
                      </span>
                      <AgentTypeSwitchOptionCopy
                        availability={availability}
                        guidanceId={guidanceId}
                        reasonId={reasonId}
                      />
                      {isUnavailable ? (
                        <WarningLine className='agent-type-switch-option-state' aria-hidden='true' size={16} />
                      ) : isSelected ? (
                        <CheckLine className='agent-type-switch-option-state' aria-hidden='true' size={16} />
                      ) : null}
                    </Menu.RadioItem>
                  )
                })}
              </Menu.RadioGroup>
            </AppScrollArea>

            {refreshError ? (
              <>
                <div className='agent-type-switch-menu-separator' role='separator' />
                <p
                  className='agent-type-switch-error'
                  role='alert'
                  aria-live='assertive'
                >
                  {refreshError}
                </p>
              </>
            ) : null}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
