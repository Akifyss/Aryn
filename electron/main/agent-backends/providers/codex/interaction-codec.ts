import type { PermissionsRequestApprovalResponse } from '../../../../../src/features/agent/codex-protocol/generated/v2/PermissionsRequestApprovalResponse'
import type { RequestPermissionProfile } from '../../../../../src/features/agent/codex-protocol/generated/v2/RequestPermissionProfile'
import type { UserInput } from '../../../../../src/features/agent/codex-protocol/generated/v2/UserInput'
import type { AgentPromptAttachment } from '../../../../../src/features/agent/types'

export function buildCodexPermissionApprovalResult(
  requestedPermissions: RequestPermissionProfile,
  optionId: string,
): PermissionsRequestApprovalResponse {
  const approved = optionId === 'allow_once' || optionId === 'allow_always'
  const permissions: PermissionsRequestApprovalResponse['permissions'] = approved
    ? {
        ...(requestedPermissions.fileSystem
          ? { fileSystem: structuredClone(requestedPermissions.fileSystem) }
          : {}),
        ...(requestedPermissions.network
          ? { network: structuredClone(requestedPermissions.network) }
          : {}),
      }
    : {}
  return {
    permissions,
    scope: optionId === 'allow_always' ? 'session' : 'turn',
  }
}

export function buildCodexApprovalResult(optionId: string, protocol: 'legacy' | 'v2') {
  if (protocol === 'legacy') {
    return {
      decision: optionId === 'allow_always'
        ? 'approved_for_session'
        : optionId === 'allow_once'
          ? 'approved'
          : 'denied',
    }
  }
  return {
    decision: optionId === 'allow_always'
      ? 'acceptForSession'
      : optionId === 'allow_once'
        ? 'accept'
        : 'decline',
  }
}

export function buildCodexUserInputs(
  prompt: string,
  attachments: AgentPromptAttachment[],
): UserInput[] {
  const inputs: UserInput[] = prompt ? [{ type: 'text', text: prompt, text_elements: [] }] : []
  for (const attachment of attachments) {
    if (attachment.kind === 'file' && attachment.path) {
      inputs.push({ type: 'mention', name: attachment.fileName, path: attachment.path })
    } else if (attachment.kind === 'image') {
      if (attachment.data) inputs.push({ type: 'image', url: attachment.data })
      else if (attachment.path) inputs.push({ type: 'localImage', path: attachment.path })
    }
  }
  if (inputs.length === 0) throw new Error('Codex prompt must include text or an attachment.')
  return inputs
}
