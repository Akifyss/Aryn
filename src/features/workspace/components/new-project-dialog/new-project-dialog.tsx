import { useLayoutEffect, useState } from 'react'
import { Button, Modal } from '@heroui/react'
import { Icon } from '@iconify/react'
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

  useLayoutEffect(() => {
    if (isOpen) {
      setProjectName('')
    }
  }, [isOpen])

  const trimmedProjectName = projectName.trim()

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container className='project-create-modal-container'>
        <Modal.Dialog
          aria-label='新建空白项目'
          className={`project-create-modal ${theme === 'dark' ? 'dark' : ''}`}
        >
          <Modal.CloseTrigger className='project-create-modal-close' aria-label='关闭'>
            <Icon aria-hidden='true' icon='lucide:x' width={16} height={16} />
          </Modal.CloseTrigger>
          <Modal.Body>
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
                <h2>新建空白项目</h2>
                <p>创建后会自动切换到这个项目。</p>
              </div>
              <label className='project-create-field'>
                <span>项目名称</span>
                <input
                  autoFocus
                  autoComplete='off'
                  name='project-name'
                  value={projectName}
                  placeholder='Untitled Project'
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </label>
              <div className='project-create-footer'>
                <Button variant='tertiary' type='button' onPress={() => onOpenChange(false)}>
                  取消
                </Button>
                <Button variant='primary' type='submit' isDisabled={!trimmedProjectName || isBusy}>
                  创建
                </Button>
              </div>
            </form>
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
