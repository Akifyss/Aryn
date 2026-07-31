import { FolderOpenLine, NewFolderLine } from '@mingcute/react'
import { AppButton } from '@/components/app-button'
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
          <AppButton variant='primary' onClick={onCreateProject} disabled={isBusy}>
            <NewFolderLine aria-hidden='true' />
            新建空白项目
          </AppButton>
          <AppButton
            variant='outline'
            onClick={() => {
              void onAddExistingProject()
            }}
            disabled={isBusy}
          >
            <FolderOpenLine aria-hidden='true' />
            使用现有文件夹
          </AppButton>
        </div>
      </div>
    </div>
  )
}
