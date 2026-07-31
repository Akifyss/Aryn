import { Input } from '@heroui/react'
import { Icon } from '@iconify/react'
import { AppButton } from '@/components/app-button'
import type { ProviderAuthFlowState } from './provider-settings-model'

type ProviderAuthFlowPanelProps = {
  authFlow: ProviderAuthFlowState
  providerLabel: string
  onCancel: () => void
  onPromptDraftChange: (value: string) => void
  onSubmitPrompt: () => void
}

export function ProviderAuthFlowPanel({
  authFlow,
  providerLabel,
  onCancel,
  onPromptDraftChange,
  onSubmitPrompt,
}: ProviderAuthFlowPanelProps) {
  const authUrl = authFlow.authUrl

  return (
    <section className='settings-provider-auth-flow flex flex-col gap-4 relative overflow-hidden'>
      <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div className='flex items-center gap-3'>
          <div className='settings-auth-flow-icon flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0'>
            <Icon icon='mingcute:loading-3-line' className='size-[var(--icon-size-lg)] animate-spin' />
          </div>
          <div className='flex flex-col min-w-0'>
            <span className='text-sm font-semibold truncate'>{providerLabel} 登录中</span>
            {authFlow.instructions ? (
              <span className='settings-auth-instructions mt-1'>
                {authFlow.instructions}
              </span>
            ) : null}
          </div>
        </div>

        <div className='flex gap-2 flex-shrink-0'>
          {authUrl ? (
            <AppButton
              variant='primary'
              onClick={() => void window.appApi.openExternalLink(authUrl)}
            >
              <Icon aria-hidden='true' icon='mingcute:external-link-line' />
              打开登录页
            </AppButton>
          ) : null}
          <AppButton
            variant='outline'
            onClick={onCancel}
          >
            <Icon aria-hidden='true' icon='mingcute:close-circle-line' />
            取消登录
          </AppButton>
        </div>
      </div>

      {authFlow.prompt ? (
        <form
          className='settings-provider-prompt-form mt-2'
          onSubmit={(event) => {
            event.preventDefault()
            onSubmitPrompt()
          }}
        >
          <label className='settings-auth-prompt-label'>
            {authFlow.prompt.message}
          </label>
          <div className='flex items-center gap-2'>
            <Input
              aria-label={authFlow.prompt.message}
              className='settings-provider-input flex-1'
              autoFocus
              onChange={(event) => {
                onPromptDraftChange(event.target.value)
              }}
              placeholder={authFlow.prompt.placeholder || '输入凭据'}
              value={authFlow.promptDraft}
              variant='secondary'
            />
            <AppButton
              disabled={!authFlow.prompt.allowEmpty && !authFlow.promptDraft.trim()}
              type='submit'
              variant='primary'
            >
              提交
            </AppButton>
          </div>
        </form>
      ) : null}

      {authFlow.progress.length > 0 ? (
        <div className='settings-provider-progress mt-1'>
          <div className='settings-provider-progress-title'>连接日志</div>
          {authFlow.progress.slice(-4).map((message, index) => (
            <div key={`${message}-${index}`} className='flex items-center gap-1.5'>
              <span className='settings-progress-dot w-1 h-1 rounded-full' />
              <span>{message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
