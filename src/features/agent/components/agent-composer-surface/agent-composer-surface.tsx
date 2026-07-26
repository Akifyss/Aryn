import { useMemo } from 'react'
import { ScrollShadow, Spinner } from '@heroui/react'
import {
  AttachmentLine,
  ArrowUpLine,
  StopFill,
} from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import { getAgentDefinition } from '@/features/agent/agent-definition'
import { resolveSupportedRunningPromptBehavior } from '@/features/agent/composer/use-agent-composer-actions'
import { AgentComposerMentionInput } from '@/features/agent/components/agent-composer-mention-input/agent-composer-mention-input'
import { AgentAttachmentFileCard } from '@/features/agent/components/agent-file-card/agent-file-card'
import { AgentInteractionPanel } from '@/features/agent/components/agent-interaction-panel/agent-interaction-panel'
import { AgentModelCascader } from '@/features/agent/components/agent-model-cascader/agent-model-cascader'
import {
  AgentQueuedComposerTray,
  type AgentQueuedComposerMessage,
} from '@/features/agent/components/agent-queued-composer-tray/agent-queued-composer-tray'
import {
  AgentProjectSwitchTrigger,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import { useAgentContext } from '@/features/agent/components/agent-sidebar/agent-sidebar-context'
import type { AgentWorkspaceState } from '@/features/agent/types'
import type { ProjectRecord } from '@/features/workspace/types'
import {
  AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS,
  getAlternateRunningPromptBehavior,
  useSettingsStore,
} from '@/hooks/use-settings-store'
import './styles.css'

function buildQueuedComposerMessages(
  runtime: AgentWorkspaceState['runtime'],
): AgentQueuedComposerMessage[] {
  return [
    ...runtime.steeringMessages.map((text, index) => ({
      id: `steer:${index}:${text}`,
      index,
      kind: 'steer' as const,
      text,
    })),
    ...runtime.followUpMessages.map((text, index) => ({
      id: `followUp:${index}:${text}`,
      index,
      kind: 'followUp' as const,
      text,
    })),
  ]
}

function AgentInlineSpinner() {
  return (
    <Spinner
      aria-hidden='true'
      className='agent-inline-spinner size-4'
      color='current'
      size='sm'
    />
  )
}

type AgentComposerSurfaceProps = {
  activeProject: ProjectRecord | null
  isNewConversation: boolean
  localOverlayRoot: HTMLDivElement | null
}

export function AgentComposerSurface({
  activeProject,
  isNewConversation,
  localOverlayRoot,
}: AgentComposerSurfaceProps) {
  const runningPromptEnterBehavior = useSettingsStore((state) => state.agent.runningPromptEnterBehavior)
  const {
    activeComposerMenu,
    activeSessionPath,
    activeWorkspaceContext,
    addComposerFiles,
    agentState,
    attachmentCapabilityMessage,
    canPerformComposerAction,
    canUseComposerWithoutWorkspace,
    canUseDraftRuntimeWithoutWorkspace,
    composerAction,
    composerAttachments,
    composerState,
    configuredProviders,
    handleComposerKeyDown,
    handlePickComposerAttachments,
    handleQueuedMessageUpdate,
    handleSelectModel,
    handleSubmit,
    handleThinkingLevelSelection,
    hasComposerPayload,
    iconTheme,
    isLoading,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    modelFieldRef,
    modelInputValue,
    onOpenProjectSwitchMenu,
    onOpenProviderSettings,
    openCodeNativeSession,
    pendingInteraction,
    removeComposerAttachment,
    resolvedSelectedProviderValue,
    respondToInteraction,
    selectedAgentId,
    setActiveComposerMenu,
    setComposerState,
    setPanelError,
    shouldShowComposerSendSpinner,
    streamingShortcutModifierLabel,
    surfaceMode,
    thinkingLevel,
    thinkingLevelLabel,
    workspacePath,
    workspaceTree,
  } = useAgentContext()
  const effectiveRunningPromptEnterBehavior = resolveSupportedRunningPromptBehavior(
    agentState.runtime.supportedRunningPromptBehaviors,
    runningPromptEnterBehavior,
  )
  const alternateRunningPromptBehavior = getAlternateRunningPromptBehavior(
    effectiveRunningPromptEnterBehavior,
  )
  const supportsAlternateRunningPromptBehavior = agentState.runtime.supportedRunningPromptBehaviors
    .includes(alternateRunningPromptBehavior)
  const isOpenCodeChildSession = Boolean(openCodeNativeSession?.parentSessionId)
  const isViewingActiveRuntime = Boolean(
    activeSessionPath
    && agentState.activeSession?.sessionPath === activeSessionPath,
  )
  const queuedComposerMessages = useMemo(
    () => isViewingActiveRuntime ? buildQueuedComposerMessages(agentState.runtime) : [],
    [agentState.runtime, isViewingActiveRuntime],
  )
  const composerActionTitle = composerAction === 'stop'
    ? '停止当前运行'
    : agentState.runtime.isStreaming && hasComposerPayload
      ? supportsAlternateRunningPromptBehavior
        ? `Enter ${AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[effectiveRunningPromptEnterBehavior]}，${streamingShortcutModifierLabel} ${AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[alternateRunningPromptBehavior]}`
        : `Enter ${AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[effectiveRunningPromptEnterBehavior]}`
      : '发送消息'

  const composerHeader = composerAttachments.length > 0 || attachmentCapabilityMessage ? (
    <ScrollShadow
      hideScrollBar
      className='agent-composer-attachments'
      orientation='horizontal'
      size={28}
      onWheel={(event) => {
        const element = event.currentTarget
        const horizontalDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY

        if (!horizontalDelta || element.scrollWidth <= element.clientWidth) {
          return
        }

        const maxScrollLeft = element.scrollWidth - element.clientWidth
        const nextScrollLeft = Math.min(
          Math.max(element.scrollLeft + horizontalDelta, 0),
          maxScrollLeft,
        )

        if (nextScrollLeft === element.scrollLeft) {
          return
        }

        event.preventDefault()
        element.scrollLeft = nextScrollLeft
      }}
    >
      <div className='agent-composer-attachments-content'>
        {composerAttachments.map((attachment) => (
          <AgentAttachmentFileCard
            attachment={attachment}
            iconTheme={iconTheme}
            key={attachment.id}
            onRemove={() => {
              removeComposerAttachment(attachment.id)
            }}
          />
        ))}
        {attachmentCapabilityMessage ? (
          <div className='agent-composer-attachment-warning'>
            {attachmentCapabilityMessage}
          </div>
        ) : null}
      </div>
    </ScrollShadow>
  ) : null
  const composerQueuedTray = queuedComposerMessages.length > 0 ? (
    <AgentQueuedComposerTray
      canUpdate={agentState.runtime.supportsQueuedMessageEditing}
      menuPortalTarget={surfaceMode === 'drawer' ? localOverlayRoot : undefined}
      messages={queuedComposerMessages}
      onUpdate={handleQueuedMessageUpdate}
    />
  ) : null
  const composerHeaderContent = composerQueuedTray || composerHeader ? (
    <>
      {pendingInteraction ? (
        <AgentInteractionPanel
          request={pendingInteraction}
          onRespond={respondToInteraction}
        />
      ) : null}
      {composerQueuedTray}
      {composerHeader}
    </>
  ) : pendingInteraction ? (
    <AgentInteractionPanel
      request={pendingInteraction}
      onRespond={respondToInteraction}
    />
  ) : null
  const projectSwitchBar = isNewConversation ? (
    <div className='agent-new-project-bar'>
      <AgentProjectSwitchTrigger
        activeProject={activeWorkspaceContext.kind === 'project' ? activeProject : null}
        onOpenProjectSwitchMenu={onOpenProjectSwitchMenu}
        placeholder={activeWorkspaceContext.kind === 'conversationDraft' ? '选择工作目录' : undefined}
        size='sm'
      />
    </div>
  ) : null

  const composerFooter = (
    <div ref={modelFieldRef} className='agent-composer-meta'>
      <div className='agent-composer-actions'>
        <AgentModelCascader
          availableModels={agentState.runtime.availableModels}
          availableThinkingLevels={agentState.runtime.availableThinkingLevels}
          availableThinkingLevelsByModel={agentState.runtime.availableThinkingLevelsByModel}
          configuredProviders={configuredProviders}
          currentModelId={modelInputValue}
          currentProvider={resolvedSelectedProviderValue}
          currentThinkingLevel={thinkingLevel}
          currentThinkingLevelLabel={thinkingLevelLabel}
          disabled={
            isOpenCodeChildSession
            || (!workspacePath && !canUseDraftRuntimeWithoutWorkspace)
            || !agentState.runtime.hasConfiguredModels
            || isSwitchingModel
            || isSwitchingThinkingLevel
          }
          isOpen={activeComposerMenu === 'model-cascader'}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              setPanelError(null)
            }
            setActiveComposerMenu(isOpen ? 'model-cascader' : null)
          }}
          onOpenProviderSettings={onOpenProviderSettings}
          onSelectModel={handleSelectModel}
          onSelectThinkingLevel={handleThinkingLevelSelection}
        />

        <div className='agent-composer-right-actions'>
          <AppIconButton
            type='button'
            aria-label='附加文件'
            disabled={
              isOpenCodeChildSession
              || (!workspacePath && !canUseComposerWithoutWorkspace)
              || isLoading
            }
            tooltip='附加文件'
            onClick={() => {
              void handlePickComposerAttachments()
            }}
          >
            <AttachmentLine aria-hidden='true' size={16} />
          </AppIconButton>

          <AppIconButton
            aria-label={composerAction === 'stop' ? '停止当前运行' : '发送消息'}
            disabled={!canPerformComposerAction}
            type='submit'
            variant={composerAction === 'stop' ? 'ghost' : 'solid'}
            className={`agent-send-button${composerAction === 'stop' ? ' is-stop' : ''}`}
            tooltip={composerActionTitle}
          >
            {composerAction === 'stop' ? (
              <StopFill size={16} />
            ) : shouldShowComposerSendSpinner ? (
              <AgentInlineSpinner />
            ) : (
              <ArrowUpLine size={16} />
            )}
          </AppIconButton>
        </div>
      </div>
    </div>
  )

  return (
    <form
      className='agent-composer'
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
    >
      <div className={`agent-composer-shell${projectSwitchBar ? ' has-project-bar' : ''}`}>
        {projectSwitchBar}
        <AgentComposerMentionInput
          aria-label={`向 ${getAgentDefinition(selectedAgentId).label} 发送消息`}
          disabled={
            isOpenCodeChildSession
            || (!workspacePath && !canUseComposerWithoutWorkspace)
            || isLoading
          }
          iconTheme={iconTheme}
          mentions={composerState.mentions}
          onChange={setComposerState}
          onFilesPastedOrDropped={(files) => {
            void addComposerFiles(files)
          }}
          onSubmitShortcut={handleComposerKeyDown}
          portalContainer={surfaceMode === 'drawer' ? localOverlayRoot : undefined}
          placeholder={workspacePath ? '发送消息，输入 @ 来提及文件...' : '发送消息...'}
          value={composerState.value}
          workspaceNodes={workspaceTree}
          workspacePath={workspacePath}
          header={composerHeaderContent}
          footer={composerFooter}
        />
      </div>
    </form>
  )
}
