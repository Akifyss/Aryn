import { Button } from '@heroui/react'
import type { WorkspaceNode } from '@/features/workspace/types'

type WorkspaceTreeProps = {
  activeFilePath: string | null
  nodes: WorkspaceNode[]
  onSelectFile: (path: string) => void
}

type TreeNodeProps = {
  activeFilePath: string | null
  depth: number
  node: WorkspaceNode
  onSelectFile: (path: string) => void
}

function TreeNode({ activeFilePath, depth, node, onSelectFile }: TreeNodeProps) {
  if (node.kind === 'directory') {
    return (
      <li>
        <div className='tree-directory' style={{ paddingLeft: `${depth * 14}px` }}>
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
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const isActive = activeFilePath === node.path

  return (
    <li>
      <Button
        className={`tree-file${isActive ? ' tree-file-active' : ''}`}
        size='sm'
        style={{ paddingLeft: `${depth * 14}px` }}
        variant='ghost'
        onPress={() => onSelectFile(node.path)}
      >
        {node.name}
      </Button>
    </li>
  )
}

export function WorkspaceTree({ activeFilePath, nodes, onSelectFile }: WorkspaceTreeProps) {
  if (nodes.length === 0) {
    return <p className='empty-copy'>Open a folder to see files.</p>
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
        />
      ))}
    </ul>
  )
}
