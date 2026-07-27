import { useEffect, useState } from 'react'
import { Input, Switch } from '@heroui/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import { useSettingsStore } from '@/hooks/use-settings-store'
import {
  SettingsSelect,
  type SettingsSelectOption,
} from '@/features/settings/components/settings-dialog/settings-select/settings-select'
import './styles.css'

const OUTLINE_POSITION_OPTIONS: SettingsSelectOption[] = [
  { label: '右侧', value: 'right' },
  { label: '左侧', value: 'left' },
]

type EditorSettingsSectionProps = {
  isActive: boolean
}

export function EditorSettingsSection({
  isActive,
}: EditorSettingsSectionProps) {
  const meo = useSettingsStore((state) => state.meo)
  const updateMeoSettings = useSettingsStore((state) => state.updateMeoSettings)
  const [meoImageFolderDraft, setMeoImageFolderDraft] = useState(meo.imageFolder)

  useEffect(() => {
    setMeoImageFolderDraft(meo.imageFolder)
  }, [meo.imageFolder])

  function commitMeoImageFolderDraft() {
    updateMeoSettings({ imageFolder: meoImageFolderDraft })
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
        <div className='settings-field'>
          <div className='settings-copy-block'>
            <h4>Markdown 编辑器</h4>
            <p>配置默认 Markdown 编辑器的侧栏、Git 高亮与资源目录行为。</p>
          </div>

          <div className='settings-inline-form settings-editor-controls'>
            <div className='settings-field settings-field-grow'>
              <span className='settings-field-label'>大纲位置</span>
              <SettingsSelect
                ariaLabel='大纲位置'
                className='settings-field-grow'
                options={OUTLINE_POSITION_OPTIONS}
                value={meo.outlinePosition}
                onValueChange={(nextValue) => {
                  if (nextValue === 'left' || nextValue === 'right') {
                    updateMeoSettings({ outlinePosition: nextValue })
                  }
                }}
              />
            </div>

            <div className='settings-field settings-field-grow settings-switch-row'>
              <span className='settings-field-label'>Git 行级高亮（Source 专用）</span>
              <Switch
                aria-label='Git 行级高亮'
                className='settings-switch-control'
                isSelected={meo.gitDiffLineHighlights}
                onChange={(isSelected) => {
                  updateMeoSettings({ gitDiffLineHighlights: isSelected })
                }}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            </div>

            <div className='settings-field settings-field-grow settings-switch-row'>
              <span className='settings-field-label'>聚焦行高亮</span>
              <Switch
                aria-label='聚焦行高亮'
                className='settings-switch-control'
                isSelected={meo.focusedLineHighlight}
                onChange={(isSelected) => {
                  updateMeoSettings({ focusedLineHighlight: isSelected })
                }}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            </div>
          </div>

          <div className='settings-inline-form settings-editor-image-folder'>
            <div className='settings-field settings-field-grow'>
              <span className='settings-field-label'>图片保存目录</span>
              <Input
                aria-label='编辑器图片保存目录'
                className='settings-field-grow'
                onChange={(event) => {
                  setMeoImageFolderDraft(event.target.value)
                }}
                onBlur={commitMeoImageFolderDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitMeoImageFolderDraft()
                  }
                }}
                placeholder='assets'
                value={meoImageFolderDraft}
                variant='secondary'
              />
              <p className='settings-inline-hint'>
                相对于工作区根目录。留空或无效值会回退到 <code>assets</code>。
              </p>
            </div>
          </div>
        </div>
      </div>
    </AppScrollArea>
  )
}
