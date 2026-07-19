import { Button } from '@heroui/react'
import { FolderOpenLine, NewFolderLine } from '@mingcute/react'
import './styles.css'

type ProjectBootstrapProps = {
  isBusy: boolean
  onAddExistingProject: () => Promise<void> | void
  onCreateProject: () => void
}

export function ProjectBootstrap({
  isBusy,
  onAddExistingProject,
  onCreateProject,
}: ProjectBootstrapProps) {
  return (
    <div className='project-bootstrap'>
      <div className='project-bootstrap-panel'>
        <div className='project-bootstrap-logo' aria-hidden='true'>
          <img src='./branding/logo.svg' alt='' width={74} height={74} />
        </div>
        <div className='project-bootstrap-copy'>
          <h1>选择一个项目开始</h1>
          <p>Aryn 会把编辑器、Git、文件树和 Agent 对话绑定到当前项目。</p>
        </div>
        <div className='project-bootstrap-actions'>
          <Button variant='primary' onPress={onCreateProject} isDisabled={isBusy}>
            <NewFolderLine aria-hidden='true' className='mr-2' size={16} />
            新建空白项目
          </Button>
          <Button
            variant='outline'
            onPress={() => {
              void onAddExistingProject()
            }}
            isDisabled={isBusy}
          >
            <FolderOpenLine aria-hidden='true' className='mr-2' size={16} />
            使用现有文件夹
          </Button>
        </div>
      </div>
    </div>
  )
}
