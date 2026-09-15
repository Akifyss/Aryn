import { useEffect } from 'react'
import type { TerminalCloseConfirmation } from '../../../electron/shared/contracts/terminal'
import type { AppConfirmationOptions } from '@/components/app-confirm-dialog/app-confirm-dialog'

export function terminalCloseConfirmationOptions(request: TerminalCloseConfirmation): AppConfirmationOptions {
  const verb = request.action === 'restart' ? '重新启动' : '关闭'
  return {
    title: request.status === 'busy' ? `任务仍在运行，${verb}终端？` : `${verb}此终端？`,
    message: request.status === 'unknown'
      ? `暂时无法确认终端是否空闲。${verb}将结束此终端中可能仍在运行的任务。`
      : `${request.processes.length ? `仍在运行：${request.processes.join('、')}。\n` : ''}${verb}将中断此终端中的任务，并结束 shell 及其子进程。`,
    cancelLabel: '取消',
    confirmLabel: `${verb}终端`,
    isDanger: true,
  }
}

// The app owns the dialog so moving a terminal or switching projects cannot
// unmount a pending confirmation. Main still owns the activity/generation checks.
export function useTerminalCloseConfirmation(requestConfirmation: (options: AppConfirmationOptions) => Promise<boolean>) {
  useEffect(() => window.appApi.terminal.onCloseConfirmation(request => {
    void requestConfirmation(terminalCloseConfirmationOptions(request)).then(confirmed => {
      window.appApi.terminal.respondCloseConfirmation(request.requestId, confirmed)
    })
  }), [requestConfirmation])
}
