import { AppDialog } from '@/components/app-dialog'
import { AppearanceSettingsSection } from '@/features/settings/components/settings-dialog/appearance-settings-section/appearance-settings-section'
import { ConversationSettingsSection } from '@/features/settings/components/settings-dialog/conversation-settings-section/conversation-settings-section'
import { EditorSettingsSection } from '@/features/settings/components/settings-dialog/editor-settings-section/editor-settings-section'
import { ProviderSettingsSection } from '@/features/settings/components/settings-dialog/provider-settings-section/provider-settings-section'
import type { AgentWorkspaceState } from '@/features/agent/types'
import type {
  WorkspaceIconThemeCatalogOption,
  WorkspaceIconThemeMode,
  WorkspaceIconThemeSelection,
  WorkspaceIconThemesByMode,
} from '@/features/workspace/types'
import './styles.css'

export type SettingsSectionId = 'appearance' | 'conversation' | 'editor' | 'providers'

type SettingsViewProps = {
  activeSection: SettingsSectionId
  agentState: AgentWorkspaceState | null
  iconThemes: WorkspaceIconThemesByMode
  iconThemeOptions: WorkspaceIconThemeCatalogOption[]
  isIconThemeBusy: boolean
  onAgentStateChange: (state: AgentWorkspaceState) => void
  onSectionChange: (section: SettingsSectionId) => void
  onSelectIconTheme: (
    mode: WorkspaceIconThemeMode,
    selection: WorkspaceIconThemeSelection,
  ) => Promise<void>
  onStatusMessage: (message: string) => void
  resolvedTheme: 'light' | 'dark'
  workspacePath: string | null
}

type SettingsDialogProps = SettingsViewProps & {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

const SETTINGS_SECTIONS: ReadonlyArray<{
  id: SettingsSectionId
  label: string
}> = [
  {
    id: 'appearance',
    label: '外观',
  },
  {
    id: 'conversation',
    label: '对话',
  },
  {
    id: 'editor',
    label: '编辑器',
  },
  {
    id: 'providers',
    label: '服务提供商',
  },
]

function getSectionTitle(section: SettingsSectionId) {
  return SETTINGS_SECTIONS.find((item) => item.id === section)?.label ?? '设置'
}

function SettingsView({
  activeSection,
  agentState,
  iconThemes,
  iconThemeOptions,
  isIconThemeBusy,
  onAgentStateChange,
  onSectionChange,
  onSelectIconTheme,
  onStatusMessage,
  resolvedTheme,
  workspacePath,
}: SettingsViewProps) {
  return (
    <div className={`settings-page ${resolvedTheme === 'dark' ? 'dark theme-dark' : 'theme-light'}`}>
      <aside className='settings-sidebar'>
        <div className='settings-sidebar-header'>
          <h2 className='settings-sidebar-title'>设置</h2>
        </div>

        <nav className='settings-nav' aria-label='设置分区'>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type='button'
              aria-current={section.id === activeSection ? 'page' : undefined}
              className={`settings-nav-item ${section.id === activeSection ? 'is-active' : ''}`}
              onClick={() => onSectionChange(section.id)}
            >
              <span className='settings-nav-label'>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className='settings-panel'>
        <div className='settings-panel-header'>
          <h3 className='settings-panel-title'>{getSectionTitle(activeSection)}</h3>
        </div>

        <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
          <ProviderSettingsSection
            agentState={agentState}
            isActive={activeSection === 'providers'}
            onAgentStateChange={onAgentStateChange}
            onStatusMessage={onStatusMessage}
            workspacePath={workspacePath}
          />
          <AppearanceSettingsSection
            iconThemes={iconThemes}
            iconThemeOptions={iconThemeOptions}
            isActive={activeSection === 'appearance'}
            isIconThemeBusy={isIconThemeBusy}
            onSelectIconTheme={onSelectIconTheme}
          />
          <ConversationSettingsSection
            isActive={activeSection === 'conversation'}
          />
          <EditorSettingsSection
            isActive={activeSection === 'editor'}
          />
        </div>
      </section>
    </div>
  )
}

export function SettingsDialog({
  isOpen,
  onOpenChange,
  resolvedTheme,
  ...viewProps
}: SettingsDialogProps) {
  return (
    <AppDialog.Root
      open={isOpen}
      onOpenChange={onOpenChange}
    >
      <AppDialog.Popup
        size='custom'
        showCloseButton
        className={`settings-dialog ${resolvedTheme === 'dark' ? 'dark' : ''}`}
      >
        <AppDialog.Title className='sr-only'>设置</AppDialog.Title>
        <AppDialog.Body>
          <SettingsView
            {...viewProps}
            resolvedTheme={resolvedTheme}
          />
        </AppDialog.Body>
      </AppDialog.Popup>
    </AppDialog.Root>
  )
}
