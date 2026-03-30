import { FormEvent, useState } from 'react'
import { Button, Input, Tooltip } from '@heroui/react'
import {
  CheckLine,
  CloseLine,
  Delete2Line,
  Edit2Line,
  FileLine,
  FolderFill,
} from '@mingcute/react'
import type { WorkspaceNode } from '@/features/workspace/types'

type WorkspaceTreeProps = {
  activeFilePath: string | null
  nodes: WorkspaceNode[]
  onSelectFile: (path: string) => void
  onRenameFile: (path: string, nextName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
}

type TreeNodeProps = {
  activeFilePath: string | null
  depth: number
  node: WorkspaceNode
  onSelectFile: (path: string) => void
  onRenameFile: (path: string, nextName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
}

function TreeNode({ activeFilePath, depth, node, onSelectFile, onRenameFile, onDeleteFile }: TreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const [actionError, setActionError] = useState<string | null>(null)

  if (node.kind === 'directory') {
    return (
      <li>
        <div
          className='tree-directory'
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <FolderFill size={14} />
          <span>{node.name}</span>
        </div>

        {node.children && node.children.length > 0 ? (
          <ul className='tree-list'>
            {node.children.map((childNode) => (
              <TreeNode
                key={childNode.path}
                activeFilePath={activeFilePath}
                depth={depth + 1}
                node={childNode}
                onSelectFile={onSelectFile}
                onRenameFile={onRenameFile}
                onDeleteFile={onDeleteFile}
              />
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

  const isActive = activeFilePath === node.path

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    try {
      setIsSubmitting(true)
      setActionError(null)
      await onRenameFile(node.path, draftName)
      setIsEditing(false)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to rename file.')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function triggerDelete() {
    try {
      setIsSubmitting(true)
      setActionError(null)
      await onDeleteFile(node.path)
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to delete file.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <li className={`tree-item ${isActive ? 'is-active' : ''}`}>
      {isEditing ? (
        <form
          className='tree-inline-rename'
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onSubmit={(event) => {
            void submitRename(event)
          }}
        >
          <Input
            autoFocus
            value={draftName}
            aria-label='Rename file'
            className='tree-rename-input'
            onChange={(event) => {
              setDraftName(event.target.value)
              if (actionError) {
                setActionError(null)
              }
            }}
            variant='secondary'
          />

          <div className='tree-inline-actions'>
            <Button className='tree-rename-action' isIconOnly size='sm' variant='ghost' type='submit' isDisabled={isSubmitting}>
              <CheckLine size={14} />
            </Button>
            <Button
              className='tree-rename-action'
              isIconOnly
              size='sm'
              variant='ghost'
              type='button'
              onPress={() => {
                setDraftName(node.name)
                setIsEditing(false)
                setActionError(null)
              }}
            >
              <CloseLine size={14} />
            </Button>
          </div>
        </form>
      ) : (
        <div
          className={`tree-file-row ${isActive ? 'is-active' : ''}`}
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
        >
          <Button
            className='tree-file'
            size='sm'
            variant='ghost'
            onPress={() => onSelectFile(node.path)}
          >
            <div className='tree-file-content'>
              <FileLine size={14} className='tree-file-icon' />
              <span className='tree-file-name'>{node.name}</span>
            </div>
          </Button>

          <div className='tree-item-actions'>
            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  size='sm'
                  variant='ghost'
                  className='tree-action-button'
                  onPress={() => {
                    setDraftName(node.name)
                    setActionError(null)
                    setIsEditing(true)
                  }}
                >
                  <Edit2Line size={14} />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Rename</Tooltip.Content>
            </Tooltip>

            <Tooltip>
              <Tooltip.Trigger>
                <Button
                  isIconOnly
                  size='sm'
                  variant='ghost'
                  className='tree-action-button'
                  isDisabled={isSubmitting}
                  onPress={() => {
                    void triggerDelete()
                  }}
                >
                  <Delete2Line size={14} />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>Delete</Tooltip.Content>
            </Tooltip>
          </div>
        </div>
      )}

      {actionError ? <p className='tree-item-error'>{actionError}</p> : null}
    </li>
  )
}

export function WorkspaceTree({ activeFilePath, nodes, onSelectFile, onRenameFile, onDeleteFile }: WorkspaceTreeProps) {
  if (nodes.length === 0) {
    return (
      <div className='tree-empty-state'>
        <div className='tree-empty-icon'>
          <FolderFill size={26} />
        </div>
        <p>Connect a workspace folder to browse and edit your notes.</p>
      </div>
    )
  }

  return (
    <ul className='tree-list'>
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          activeFilePath={activeFilePath}
          depth={0}
          node={node}
          onSelectFile={onSelectFile}
          onRenameFile={onRenameFile}
          onDeleteFile={onDeleteFile}
        />
      ))}
    </ul>
  )
}
