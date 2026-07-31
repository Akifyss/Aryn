import { Input } from '@heroui/react'
import { Icon } from '@iconify/react'
import { AppButton } from '@/components/app-button'
import { AppIconButton } from '@/components/app-icon-button'
import type { AgentProviderCategory } from '@/features/agent/provider-auth'
import { ProviderIcon } from './provider-icon'
import {
  getProviderMeta,
  getProviderStatus,
  type AuthProviderGroupViewModel,
  type ProviderStatus,
} from './provider-settings-model'

type ProviderCardProps = {
  activeCategory: AgentProviderCategory
  draftValue: string
  isBusy: boolean
  isExpanded: boolean
  provider: AuthProviderGroupViewModel
  showPassword: boolean
  onDraftChange: (value: string) => void
  onLogin: () => void
  onLogout: () => void
  onSave: (apiKey: string | null) => void
  onShowPasswordChange: (showPassword: boolean) => void
  onToggle: () => void
}

function getProviderStatusClass(color: ProviderStatus['color']) {
  switch (color) {
    case 'emerald':
      return 'provider-status-badge-success'
    case 'amber':
      return 'provider-status-badge-warning'
    case 'blue':
      return 'provider-status-badge-info'
    default:
      return 'provider-status-badge-muted'
  }
}

export function ProviderCard({
  activeCategory,
  draftValue,
  isBusy,
  isExpanded,
  provider,
  showPassword,
  onDraftChange,
  onLogin,
  onLogout,
  onSave,
  onShowPasswordChange,
  onToggle,
}: ProviderCardProps) {
  const status = getProviderStatus(provider, activeCategory)
  const hasStoredApiKey = provider.state.storedCredentialType === 'api_key'
  const hasStoredOAuth = provider.state.storedCredentialType === 'oauth'
  const showsOAuthActions = provider.groupCategory === 'subscription'
    && provider.supportsOAuth
  const showsApiKeyActions = provider.groupCategory !== 'subscription'
    && provider.supportsApiKey
  const canClearStoredCredential = (
    (showsOAuthActions && hasStoredOAuth)
    || (showsApiKeyActions && hasStoredApiKey)
  )
  const detailsId = `settings-provider-${provider.key}-details`

  return (
    <div className={`provider-card ${isExpanded ? 'is-expanded' : ''}`}>
      <button
        type='button'
        aria-controls={detailsId}
        aria-expanded={isExpanded}
        onClick={onToggle}
        className='provider-card-header flex items-center justify-between p-4 w-full text-left font-inherit rounded-t-2xl'
      >
        <div className='flex items-center gap-3 min-w-0'>
          <div className='flex-shrink-0'>
            <ProviderIcon provider={provider.key} size={18} />
          </div>

          <div className='flex flex-col min-w-0'>
            <span className='text-sm font-semibold truncate'>
              {provider.label}
            </span>
          </div>
        </div>

        <div className='flex items-center gap-2 flex-shrink-0'>
          <span
            className={`provider-status-badge text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 ${getProviderStatusClass(status.color)}`}
          >
            <span className='w-1.5 h-1.5 rounded-full bg-current opacity-60' />
            {status.label}
          </span>

          <Icon
            icon='mingcute:down-line'
            className={`settings-secondary-icon w-4 h-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      <div
        id={detailsId}
        aria-hidden={!isExpanded}
        className={`provider-card-details-wrapper ${isExpanded ? 'is-expanded' : ''}`}
        inert={isExpanded ? undefined : true}
      >
        <div className='provider-card-details-inner'>
          <div className='provider-card-details-body'>
            <div className='provider-meta-info flex flex-col gap-2 mt-3'>
              <div className='provider-config-status'>
                <p className='font-medium mb-1'>当前配置状态：</p>
                <p className='settings-secondary-text'>{getProviderMeta(provider)}</p>
              </div>

              {provider.setupHint ? (
                <div className='provider-setup-hint flex gap-2 p-3 rounded-xl'>
                  <Icon
                    icon='mingcute:information-line'
                    className='w-4 h-4 flex-shrink-0 mt-0.5'
                  />
                  <span>{provider.setupHint}</span>
                </div>
              ) : null}
            </div>

            {showsApiKeyActions ? (
              <div className='provider-apikey-form flex flex-col gap-2'>
                <label className='provider-apikey-label'>配置 API 密钥</label>
                <div className='relative flex items-center w-full provider-apikey-input-container'>
                  <span className='settings-secondary-icon absolute left-3 pointer-events-none flex items-center justify-center z-20'>
                    <Icon icon='mingcute:key-2-line' className='w-4 h-4' />
                  </span>
                  <Input
                    aria-label={`${provider.label} API key`}
                    className='settings-provider-input w-full'
                    disabled={isBusy}
                    onChange={(event) => {
                      onDraftChange(event.target.value)
                    }}
                    placeholder={provider.placeholder || '输入 API 密钥'}
                    type={showPassword ? 'text' : 'password'}
                    value={draftValue}
                    variant='secondary'
                  />
                  <AppIconButton
                    type='button'
                    disabled={isBusy}
                    aria-label={showPassword ? 'Hide API key' : 'Show API key'}
                    tooltip={showPassword ? '隐藏 API 密钥' : '显示 API 密钥'}
                    onClick={() => {
                      onShowPasswordChange(!showPassword)
                    }}
                    className='absolute right-3 z-10'
                  >
                    <Icon
                      icon={showPassword ? 'mingcute:eye-line' : 'mingcute:eye-close-line'}
                      className='w-4 h-4'
                    />
                  </AppIconButton>
                </div>
              </div>
            ) : null}

            <div className='provider-actions flex flex-wrap gap-2 mt-1 justify-end'>
              {showsOAuthActions ? (
                <AppButton
                  disabled={isBusy}
                  variant='primary'
                  onClick={onLogin}
                >
                  <Icon aria-hidden='true' icon='mingcute:entrance-line' />
                  {hasStoredOAuth ? '重新登录' : '订阅登录'}
                </AppButton>
              ) : null}

              {showsApiKeyActions ? (
                <AppButton
                  disabled={isBusy || !draftValue.trim()}
                  variant='primary'
                  onClick={() => {
                    onSave(draftValue)
                  }}
                >
                  <Icon aria-hidden='true' icon='mingcute:check-line' />
                  保存密钥
                </AppButton>
              ) : null}

              {showsOAuthActions || showsApiKeyActions ? (
                <AppButton
                  disabled={isBusy || !canClearStoredCredential}
                  tone='danger'
                  variant='outline'
                  onClick={() => {
                    if (showsOAuthActions) {
                      onLogout()
                    } else {
                      onSave(null)
                    }
                  }}
                >
                  <Icon
                    aria-hidden='true'
                    icon={showsOAuthActions
                      ? 'mingcute:exit-line'
                      : 'mingcute:delete-2-line'}
                  />
                  {showsOAuthActions ? '退出登录' : '清除密钥'}
                </AppButton>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
