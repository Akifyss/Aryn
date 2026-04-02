import { FormEvent, useEffect, useRef, useState } from 'react'
import { Button, Input, Tooltip } from '@heroui/react'
import {
  CheckLine,
  CloseLine,
  Delete2Line,
  Edit2Line,
  FileLine,
  FolderLine,
  FolderOpenLine,
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
  expandedPaths: Set<string>
  node: WorkspaceNode
  onToggleDirectory: (path: string) => void
  onSelectFile: (path: string) => void
  onRenameFile: (path: string, nextName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
}

function collectDirectoryPaths(nodes: WorkspaceNode[]): string[] {
  return nodes.flatMap((node) => {
    if (node.kind !== 'directory') {
      return []
    }

    return [node.path, ...(node.children ? collectDirectoryPaths(node.children) : [])]
  })
}

function TreeNode({
  activeFilePath,
  depth,
  expandedPaths,
  node,
  onToggleDirectory,
  onSelectFile,
  onRenameFile,
  onDeleteFile,
}: TreeNodeProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const [actionError, setActionError] = useState<string | null>(null)
  const rowIndent = `${depth * 14 + 8}px`
  const directoryIndent = `calc(${rowIndent} + 0.75rem)`

  if (node.kind === 'directory') {
    const children = node.children ?? []
    const hasChildren = children.length > 0
    const isExpanded = expandedPaths.has(node.path)

    return (
      <li className={`tree-item tree-directory-item ${isExpanded ? 'is-expanded' : ''}`}>
        <button
          type='button'
          className='tree-row tree-directory-button'
          style={{ paddingLeft: directoryIndent }}
          onClick={() => {
            if (hasChildren) {
              onToggleDirectory(node.path)
            }
          }}
          aria-expanded={hasChildren ? isExpanded : undefined}
          aria-label={hasChildren ? `${isExpanded ? 'Collapse' : 'Expand'} ${node.name}` : node.name}
        >
          <span className='tree-node-icon' aria-hidden='true'>
            {isExpanded ? <FolderOpenLine size={16} /> : <FolderLine size={16} />}
          </span>

          <span className='tree-node-name'>{node.name}</span>
        </button>

        {hasChildren && isExpanded ? (
          <ul className='tree-list'>
            {children.map((childNode) => (
              <TreeNode
                key={childNode.path}
                activeFilePath={activeFilePath}
                depth={depth + 1}
                expandedPaths={expandedPaths}
                node={childNode}
                onToggleDirectory={onToggleDirectory}
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
          style={{ paddingLeft: rowIndent }}
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
          className={`tree-row tree-file-row ${isActive ? 'is-active' : ''}`}
          style={{ paddingLeft: rowIndent }}
        >
          <Button
            className='tree-file'
            size='sm'
            variant='ghost'
            onPress={() => onSelectFile(node.path)}
          >
            <div className='tree-file-content'>
              <span className='tree-node-icon' aria-hidden='true'>
                <FileLine size={16} className='tree-file-icon' />
              </span>
              <span className='tree-file-name tree-node-name'>{node.name}</span>
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
  const previousDirectoryPathsRef = useRef<Set<string>>(new Set())
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set(collectDirectoryPaths(nodes)))

  useEffect(() => {
    const directoryPaths = collectDirectoryPaths(nodes)
    const previousDirectoryPaths = previousDirectoryPathsRef.current

    setExpandedPaths((currentPaths) => {
      const nextPaths = new Set<string>()

      if (currentPaths.size === 0 && directoryPaths.length > 0) {
        return new Set(directoryPaths)
      }

      for (const path of directoryPaths) {
        if (currentPaths.has(path) || !previousDirectoryPaths.has(path)) {
          nextPaths.add(path)
        }
      }

      return nextPaths
    })

    previousDirectoryPathsRef.current = new Set(directoryPaths)
  }, [nodes])

  if (nodes.length === 0) {
    return (
      <div className='tree-empty-state'>
        <div className='tree-empty-icon'>
          <FolderLine size={26} />
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
          expandedPaths={expandedPaths}
          node={node}
          onToggleDirectory={(path) => {
            setExpandedPaths((currentPaths) => {
              const nextPaths = new Set(currentPaths)

              if (nextPaths.has(path)) {
                nextPaths.delete(path)
              } else {
                nextPaths.add(path)
              }

              return nextPaths
            })
          }}
          onSelectFile={onSelectFile}
          onRenameFile={onRenameFile}
          onDeleteFile={onDeleteFile}
        />
      ))}
    </ul>
  )
}
