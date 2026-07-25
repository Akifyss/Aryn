import { useLayoutEffect, useRef, useState } from 'react'
import { AppButton } from '@/components/app-button'
import { AppDialog } from '@/components/app-dialog'
import './styles.css'

type NewProjectDialogProps = {
  isBusy: boolean
  isOpen: boolean
  theme: 'light' | 'dark'
  onCreate: (projectName: string) => Promise<void> | void
  onOpenChange: (isOpen: boolean) => void
}

export function NewProjectDialog({
  isBusy,
  isOpen,
  theme,
  onCreate,
  onOpenChange,
}: NewProjectDialogProps) {
  const [projectName, setProjectName] = useState('')
  const projectNameInputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (isOpen) {
      setProjectName('')
    }
  }, [isOpen])

  const trimmedProjectName = projectName.trim()

  return (
    <AppDialog.Root open={isOpen} onOpenChange={onOpenChange}>
      <AppDialog.Popup
        size='custom'
        initialFocus={projectNameInputRef}
        showCloseButton
        viewportClassName='project-create-dialog-viewport'
        className={`project-create-dialog ${theme === 'dark' ? 'dark' : ''}`}
      >
        <AppDialog.Body>
          <form
            className='project-create-form'
            onSubmit={(event) => {
              event.preventDefault()
              if (!isBusy && trimmedProjectName) {
                void onCreate(trimmedProjectName)
              }
            }}
          >
            <div className='project-create-heading'>
              <AppDialog.Title className='project-create-title'>
                新建空白项目
              </AppDialog.Title>
              <AppDialog.Description>
                创建后会自动切换到这个项目。
              </AppDialog.Description>
            </div>
            <label className='project-create-field'>
              <span>项目名称</span>
              <input
                ref={projectNameInputRef}
                autoComplete='off'
                name='project-name'
                value={projectName}
                placeholder='Untitled Project'
                onChange={(event) => setProjectName(event.target.value)}
              />
            </label>
            <AppDialog.Footer className='project-create-footer'>
              <AppDialog.Close
                render={<AppButton variant='outline' type='button' />}
              >
                取消
              </AppDialog.Close>
              <AppButton variant='primary' type='submit' disabled={!trimmedProjectName || isBusy}>
                创建
              </AppButton>
            </AppDialog.Footer>
          </form>
        </AppDialog.Body>
      </AppDialog.Popup>
    </AppDialog.Root>
  )
}
