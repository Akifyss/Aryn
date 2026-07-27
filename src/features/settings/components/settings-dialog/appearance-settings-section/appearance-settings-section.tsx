import { useMemo } from 'react'
import { Tabs } from '@heroui/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import { resolveActiveWorkspaceIconThemeKey } from '@/features/settings/lib/icon-theme-selection'
import type {
  WorkspaceIconThemeCatalogOption,
  WorkspaceIconThemeMode,
  WorkspaceIconThemeSelection,
  WorkspaceIconThemesByMode,
} from '@/features/workspace/types'
import { useSettingsStore } from '@/hooks/use-settings-store'
import { SettingsSelect } from '@/features/settings/components/settings-dialog/settings-select/settings-select'
import './styles.css'

const DEFAULT_WORKSPACE_ICON_THEME_OPTION_KEY = '__aryn-default-workspace-icon-theme__'

type AppearanceSettingsSectionProps = {
  iconThemes: WorkspaceIconThemesByMode
  iconThemeOptions: WorkspaceIconThemeCatalogOption[]
  isActive: boolean
  isIconThemeBusy: boolean
  onSelectIconTheme: (
    mode: WorkspaceIconThemeMode,
    selection: WorkspaceIconThemeSelection,
  ) => Promise<void>
}

export function AppearanceSettingsSection({
  iconThemes,
  iconThemeOptions,
  isActive,
  isIconThemeBusy,
  onSelectIconTheme,
}: AppearanceSettingsSectionProps) {
  const theme = useSettingsStore((state) => state.theme)
  const setTheme = useSettingsStore((state) => state.setTheme)
  const activeIconThemeKeys = useMemo(
    () => ({
      dark: resolveActiveWorkspaceIconThemeKey(iconThemes.dark, iconThemeOptions)
        ?? DEFAULT_WORKSPACE_ICON_THEME_OPTION_KEY,
      light: resolveActiveWorkspaceIconThemeKey(iconThemes.light, iconThemeOptions)
        ?? DEFAULT_WORKSPACE_ICON_THEME_OPTION_KEY,
    }),
    [iconThemes.dark, iconThemes.light, iconThemeOptions],
  )
  const iconThemeSelectOptions = useMemo(
    () => [
      {
        label: '默认',
        value: DEFAULT_WORKSPACE_ICON_THEME_OPTION_KEY,
      },
      ...iconThemeOptions.map((option) => ({
        label: option.label,
        value: option.key,
      })),
    ],
    [iconThemeOptions],
  )

  function handleIconThemeSelect(mode: WorkspaceIconThemeMode, value: string) {
    if (value === DEFAULT_WORKSPACE_ICON_THEME_OPTION_KEY) {
      void onSelectIconTheme(mode, {
        sourceVsixPath: null,
        themeId: null,
      })
      return
    }

    const selectedOption = iconThemeOptions.find((option) => option.key === value)

    if (selectedOption) {
      void onSelectIconTheme(mode, {
        sourceVsixPath: selectedOption.sourceVsixPath,
        themeId: selectedOption.themeId,
      })
    }
  }

  if (!isActive) {
    return null
  }

  return (
    <AppScrollArea
      className='settings-panel-content'
      contentClassName='settings-panel-content-inner'
    >
      <div className='settings-card'>
        <div className='settings-theme-switcher'>
          <div className='settings-field'>
            <span className='settings-field-label'>主题模式</span>
            <div className='settings-tabs-wrapper heroui-tabs-fix'>
              <Tabs
                selectedKey={theme}
                onSelectionChange={(key) => setTheme(key as 'light' | 'dark' | 'auto')}
                variant='primary'
                className='w-full'
              >
                <Tabs.ListContainer className='w-full'>
                  <Tabs.List aria-label='主题模式' className='w-full'>
                    <Tabs.Tab id='light' className='flex-1'>
                      浅色
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id='dark' className='flex-1'>
                      深色
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id='auto' className='flex-1'>
                      跟随系统
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
              </Tabs>
            </div>
          </div>

          <div className='settings-field settings-appearance-icon-theme-field'>
            <div className='settings-copy-block'>
              <h4>文件图标主题（浅色模式）</h4>
              <p>控制浅色模式下文件树与工作区中的图标显示样式。</p>
            </div>
            <div className='settings-inline-form settings-appearance-icon-theme-form'>
              <SettingsSelect
                ariaLabel='浅色模式文件图标主题'
                className='flex-1'
                disabled={isIconThemeBusy}
                options={iconThemeSelectOptions}
                placeholder='选择浅色图标主题'
                value={activeIconThemeKeys.light}
                onValueChange={(value) => {
                  handleIconThemeSelect('light', value)
                }}
              />
            </div>
          </div>

          <div className='settings-field settings-appearance-icon-theme-field'>
            <div className='settings-copy-block'>
              <h4>文件图标主题（暗色模式）</h4>
              <p>控制暗色模式下文件树与工作区中的图标显示样式。</p>
            </div>
            <div className='settings-inline-form settings-appearance-icon-theme-form'>
              <SettingsSelect
                ariaLabel='暗色模式文件图标主题'
                className='flex-1'
                disabled={isIconThemeBusy}
                options={iconThemeSelectOptions}
                placeholder='选择暗色图标主题'
                value={activeIconThemeKeys.dark}
                onValueChange={(value) => {
                  handleIconThemeSelect('dark', value)
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </AppScrollArea>
  )
}
