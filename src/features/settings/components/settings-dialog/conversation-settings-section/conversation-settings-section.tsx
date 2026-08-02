import { Tabs } from '@heroui/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import {
  AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS,
  getAlternateRunningPromptBehavior,
  isAgentRunningPromptEnterBehavior,
  isAgentSessionView,
  useSettingsStore,
} from '@/hooks/use-settings-store'
import './styles.css'

type ConversationSettingsSectionProps = {
  isActive: boolean
}

export function ConversationSettingsSection({
  isActive,
}: ConversationSettingsSectionProps) {
  const agent = useSettingsStore((state) => state.agent)
  const updateAgentSettings = useSettingsStore((state) => state.updateAgentSettings)
  const defaultBehavior = agent.runningPromptEnterBehavior
  const alternateBehavior = getAlternateRunningPromptBehavior(defaultBehavior)
  const modifierKey = window.appApi.platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter'

  if (!isActive) {
    return null
  }

  return (
    <AppScrollArea
      className='settings-panel-content'
      contentClassName='settings-panel-content-inner'
    >
      <div className='settings-card'>
        <div className='settings-field'>
          <div className='settings-copy-block'>
            <h4>对话视图</h4>
            <p>
              Aryn、PI、OpenCode 和 Codex 共用同一套消息时间线。Threadbar、输入框和 Agent 运行逻辑仍由 Aryn 管理。
            </p>
          </div>

          <div className='settings-tabs-wrapper heroui-tabs-fix settings-session-view-tabs'>
            <Tabs
              selectedKey={agent.sessionView}
              onSelectionChange={(key) => {
                const nextView = String(key)
                if (isAgentSessionView(nextView)) {
                  updateAgentSettings({ sessionView: nextView })
                }
              }}
              variant='primary'
              className='w-full'
            >
              <Tabs.ListContainer className='w-full'>
                <Tabs.List aria-label='Agent 对话视图' className='w-full'>
                  <Tabs.Tab id='unified' className='flex-1'>
                    统一视图
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id='native' className='flex-1'>
                    原生视图
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </div>

          <p className='settings-inline-hint'>
            默认启用统一视图；原生视图完整保留，可随时切回用于兼容或排查问题。
          </p>
        </div>
      </div>

      <div className='settings-card'>
        <div className='settings-field'>
          <div className='settings-copy-block'>
            <h4>跟进行为</h4>
            <p>
              Agent 运行中发送后续消息时，可以加入队列，或引导当前运行。{modifierKey} 会执行与 Enter 相反的操作。
            </p>
          </div>

          <div className='settings-tabs-wrapper heroui-tabs-fix settings-running-behavior-tabs'>
            <Tabs
              selectedKey={defaultBehavior}
              onSelectionChange={(key) => {
                const nextBehavior = String(key)
                if (isAgentRunningPromptEnterBehavior(nextBehavior)) {
                  updateAgentSettings({ runningPromptEnterBehavior: nextBehavior })
                }
              }}
              variant='primary'
              className='w-full'
            >
              <Tabs.ListContainer className='w-full'>
                <Tabs.List aria-label='运行中 Enter 默认行为' className='w-full'>
                  <Tabs.Tab id='followUp' className='flex-1'>
                    排队
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id='steer' className='flex-1'>
                    引导
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </div>

          <p className='settings-inline-hint'>
            运行中按 Enter 将执行{AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[defaultBehavior]}，按 {modifierKey} 将执行{AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[alternateBehavior]}。输入框为空时发送按钮会变为停止按钮。
          </p>
        </div>
      </div>
    </AppScrollArea>
  )
}
