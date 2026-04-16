type EditorPlatformNoticeProps = {
  detail?: string | null
  title: string
}

export function EditorPlatformNotice({ detail = null, title }: EditorPlatformNoticeProps) {
  return (
    <div className='editor-platform-notice' role='status'>
      <span className='editor-platform-notice-title'>{title}</span>
      {detail ? <span className='editor-platform-notice-detail'>{detail}</span> : null}
    </div>
  )
}
