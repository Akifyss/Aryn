import { FormEvent, useState } from 'react'
import { Button, Input, Tooltip } from '@heroui/react'
import type { WorkspaceNode } from '@/features/workspace/types'
import { FileFill, FolderFill, Edit2Line, Delete2Line, CheckLine, CloseLine } from '@mingcute/react'

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
          className='tree-directory flex items-center gap-2 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 select-none' 
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <FolderFill size={14} />
          {node.name}
        </div>
        {node.children && node.children.length > 0 && (
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
        )}
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
    <li className='tree-item'>
      {isEditing ? (
        <form
          className='tree-inline-rename'
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onSubmit={(event) => {
            void submitRename(event)
          }}
        >
          <Input
            autoFocus
            value={draftName}
            onChange={(event) => {
              setDraftName(event.target.value)
              if (actionError) {
                setActionError(null)
              }
            }}
          />
          <div className='tree-inline-actions'>
            <Button isIconOnly size='sm' variant='ghost' type='submit' isDisabled={isSubmitting}>
              <CheckLine size={14} />
            </Button>
            <Button
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
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <Button
            className={`tree-file h-8 rounded-md transition-all justify-start px-2 ${isActive ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
            size='sm'
            variant='ghost'
            onPress={() => onSelectFile(node.path)}
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <FileFill size={14} className={isActive ? 'text-blue-500' : 'text-slate-400'} />
              <span className="truncate">{node.name}</span>
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
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <FolderFill size={32} className="text-slate-200 mb-2" />
        <p className='text-xs text-slate-400 leading-relaxed font-medium'>Connect a workspace folder to view and edit files.</p>
      </div>
    )
  }

  return (
    <ul className='tree-list pb-8'>
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
