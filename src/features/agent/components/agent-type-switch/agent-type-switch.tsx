import { useId } from 'react'
import { CheckLine, WarningLine } from '@mingcute/react'
import { AppMenu as Menu } from '@/components/app-menu'
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
  triggerIconSize?: number
}

export function AgentTypeSwitch({
  agentCatalog,
  isLocked,
  menuPortalTarget,
  onRefresh,
  onSelect,
  refreshError,
  selectedAgentId,
  triggerIconSize = 16,
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
        disabled={isLocked}
        size='md'
        variant='ghost'
      >
        <AgentBrandIcon agentId={selectedAgentId} className='agent-brand-icon' size={triggerIconSize} />
        <span className='agent-type-switch-label'>{selectedDefinition.label}</span>
      </Menu.Trigger>
      <Menu.Portal container={menuPortalTarget ?? undefined}>
        <Menu.Positioner
          align='start'
          positionMethod='fixed'
          side='bottom'
        >
          <Menu.Popup
            aria-label='选择用于新会话的 Agent'
            size='lg'
          >
            <Menu.ScrollArea className='agent-type-switch-options-scroll'>
              <Menu.ScrollViewport>
                <Menu.ScrollContent>
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
                          aria-describedby={isUnavailable
                            ? [reasonId, guidanceId].filter(Boolean).join(' ')
                            : undefined}
                          aria-disabled={isUnavailable || undefined}
                          className={isUnavailable ? 'agent-type-switch-option-unavailable' : undefined}
                          closeOnClick={!isUnavailable}
                          description={isUnavailable ? (
                            <>
                              <span id={reasonId}>{availability.reason ?? '当前不可用'}</span>
                              {availability.guidance ? (
                                <>
                                  <span aria-hidden='true'> · </span>
                                  <span id={guidanceId}>{availability.guidance}</span>
                                </>
                              ) : null}
                            </>
                          ) : undefined}
                          info={isUnavailable ? (
                            <WarningLine aria-hidden='true' size={16} />
                          ) : isSelected ? (
                            <CheckLine aria-hidden='true' size={16} />
                          ) : undefined}
                          infoVariant='status'
                          icon={(
                            <AgentBrandIcon
                              agentId={agentId}
                              className='agent-brand-icon'
                              size={16}
                            />
                          )}
                          label={availability.definition.label}
                          selected={isSelected}
                          text={availability.definition.label}
                          value={agentId}
                          onClick={(event) => {
                            if (isUnavailable) {
                              event.preventDefault()
                            }
                          }}
                        />
                      )
                    })}
                  </Menu.RadioGroup>
                </Menu.ScrollContent>
              </Menu.ScrollViewport>
            </Menu.ScrollArea>

            {refreshError ? (
              <>
                <Menu.Separator />
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
