import { type ReactNode, useMemo, useState } from 'react'
import { AddLine, Back2Line, MarkdownLine } from '@mingcute/react'
import { Icon } from '@iconify/react'
import {
  FileChangeStatusBadge,
  WorkspaceFileIcon,
} from '@/components/file-change-visuals'
import {
  AppItem,
  AppItemActionButton,
} from '@/components/app-item'
import {
  TreeChildren,
  TreeList,
} from '@/components/tree'
import type {
  GitChangeItem,
  GitCommitFileChange,
  GitDisplayChange,
  GitPanelLayout,
} from '@/features/git/types'
import { getBaseName } from '@/features/workspace/lib/workspace-paths'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import {
  buildGitTree,
  getDirectoryLabel,
  getGitChangeKindLabel,
  isScopedGitChange,
  supportsMeoDiff,
  type GitTreeNode,
} from '../git-panel-model'
import './styles.css'

type GitChangeSectionKind = 'staged' | 'unstaged' | 'pulled' | 'commit'

type GitChangeRowsProps = {
  changes: GitDisplayChange[]
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenCommitFileDiff?: (change: GitCommitFileChange) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  iconTheme: WorkspaceIconTheme | null
  kind: GitChangeSectionKind
  layout: GitPanelLayout
}

function GitRowActions({
  kind,
  onUnstage,
  onStage,
  onDiscard,
  onOpenFile,
  onOpenMeoDiff,
  isFolder,
  change,
}: {
  kind: GitChangeSectionKind
  onUnstage?: () => void
  onStage?: () => void
  onDiscard?: () => void
  onOpenFile?: () => void
  onOpenMeoDiff?: () => void
  isFolder?: boolean
  change?: GitDisplayChange
}) {
  const scopedChange = change && isScopedGitChange(change) ? change : null
  const hasMeoDiff = change ? supportsMeoDiff(change) : false
  const canOpenFile = Boolean(scopedChange && scopedChange.kind !== 'deleted' && onOpenFile)
  const showOpenFile = !isFolder && canOpenFile
  const showMeoDiff = !isFolder && Boolean(scopedChange && hasMeoDiff)
  const showUnstage = kind === 'staged'
  const showStageControls = kind === 'unstaged'

  if (!showOpenFile && !showMeoDiff && !showUnstage && !showStageControls) {
    return null
  }

  return (
    <>
      {showOpenFile && (
        <AppItemActionButton
          aria-label='打开文件'
          title='打开文件'
          onClick={(event) => {
            event.stopPropagation()
            onOpenFile?.()
          }}
        >
          <Icon icon='material-symbols:file-export-outline-rounded' width={16} height={16} aria-hidden='true' />
        </AppItemActionButton>
      )}
      {showMeoDiff && (
        <AppItemActionButton
          aria-label='打开 MEO 分屏差异'
          title='打开 MEO 分屏差异'
          onClick={(event) => {
            event.stopPropagation()
            onOpenMeoDiff?.()
          }}
        >
          <MarkdownLine size={16} aria-hidden='true' />
        </AppItemActionButton>
      )}

      {showUnstage && (
        <AppItemActionButton
          aria-label='取消暂存'
          title='取消暂存'
          onClick={(event) => {
            event.stopPropagation()
            onUnstage?.()
          }}
        >
          <Icon icon='mdi:minus' width={16} height={16} aria-hidden='true' />
        </AppItemActionButton>
      )}

      {showStageControls && (
        <>
          <AppItemActionButton
            aria-label='放弃更改'
            title='放弃更改'
            onClick={(event) => {
              event.stopPropagation()
              onDiscard?.()
            }}
          >
            <Back2Line size={16} aria-hidden='true' />
          </AppItemActionButton>
          <AppItemActionButton
            aria-label='暂存'
            title='暂存'
            onClick={(event) => {
              event.stopPropagation()
              onStage?.()
            }}
          >
            <AddLine size={16} aria-hidden='true' />
          </AppItemActionButton>
        </>
      )}
    </>
  )
}

function GitTreeFolder({
  kind,
  node,
  onDiscardMany,
  onOpenDiff,
  onOpenCommitFileDiff,
  onOpenMeoDiff,
  onOpenFile,
  onStage,
  onUnstage,
  iconTheme,
  closedMap,
  toggleNode,
  layout,
}: {
  kind: GitChangeSectionKind
  node: GitTreeNode
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenCommitFileDiff?: (change: GitCommitFileChange) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  iconTheme: WorkspaceIconTheme | null
  closedMap: Record<string, boolean>
  toggleNode: (id: string) => void
  layout: GitPanelLayout
}) {
  const isClosed = closedMap[node.id] ?? false
  const activeItems = node.items.filter(isScopedGitChange)
  const paths = activeItems.map((item) => item.path)

  const localItems = node.items.filter((item) => {
    const parentPath = item.relativePath.substring(0, item.relativePath.lastIndexOf('/'))
    return parentPath === node.path
  })

  return (
    <AppItem
      after={!isClosed ? (
        <TreeChildren>
          <TreeList>
            {node.children.map((child) => (
              <GitTreeFolder
                key={child.id}
                kind={kind}
                node={child}
                onDiscardMany={onDiscardMany}
                onOpenDiff={onOpenDiff}
                onOpenCommitFileDiff={onOpenCommitFileDiff}
                onOpenMeoDiff={onOpenMeoDiff}
                onOpenFile={onOpenFile}
                onStage={onStage}
                onUnstage={onUnstage}
                iconTheme={iconTheme}
                closedMap={closedMap}
                toggleNode={toggleNode}
                layout={layout}
              />
            ))}
            <GitChangeRows
              changes={localItems}
              kind={kind}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenCommitFileDiff={onOpenCommitFileDiff}
              onOpenMeoDiff={onOpenMeoDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              iconTheme={iconTheme}
              layout={layout}
            />
          </TreeList>
        </TreeChildren>
      ) : null}
      icon={<WorkspaceFileIcon isFolder nodeLabel={node.label} isClosed={isClosed} iconTheme={iconTheme} />}
      label={node.label}
      mainButtonProps={{
        'aria-expanded': !isClosed,
        onClick: () => toggleNode(node.id),
      }}
      actions={() => (
        <GitRowActions
          kind={kind}
          isFolder
          onStage={() => onStage(paths)}
          onUnstage={() => onUnstage(paths)}
          onDiscard={() => onDiscardMany(activeItems)}
        />
      )}
      info={node.items.length}
      infoVariant='count'
    />
  )
}

export function GitChangeRows({
  changes,
  onDiscardMany,
  onOpenDiff,
  onOpenCommitFileDiff,
  onOpenMeoDiff,
  onOpenFile,
  onStage,
  onUnstage,
  iconTheme,
  kind,
  layout,
}: GitChangeRowsProps) {
  return (
    <>
      {changes.map((change) => {
        const fileName = getBaseName(change.relativePath)
        const dirLabel = getDirectoryLabel(change.relativePath)
        const isChange = isScopedGitChange(change)
        const pathMeta = layout === 'list' ? dirLabel : ''
        const changeKindLabel = getGitChangeKindLabel(change.kind)

        return (
          <AppItem
            key={change.path}
            icon={<WorkspaceFileIcon fileName={fileName} iconTheme={iconTheme} />}
            label={fileName}
            description={pathMeta || undefined}
            mainButtonProps={{
              title: change.relativePath,
              onClick: () => {
                if (isChange) onOpenDiff(change)
                else if (kind === 'commit') onOpenCommitFileDiff?.(change)
                else onOpenFile(change.path)
              },
            }}
            actions={() => (
              <GitRowActions
                kind={kind}
                change={change}
                onStage={() => onStage([change.path])}
                onUnstage={() => onUnstage([change.path])}
                onDiscard={() => onDiscardMany([change as GitChangeItem])}
                onOpenFile={() => onOpenFile(change.path)}
                onOpenMeoDiff={() => isChange && onOpenMeoDiff(change)}
              />
            )}
            info={(
              <FileChangeStatusBadge
                kind={change.kind}
                title={changeKindLabel}
              />
            )}
            infoVariant='status'
          />
        )
      })}
    </>
  )
}

function GitChangeList(props: GitChangeRowsProps) {
  if (props.changes.length === 0) {
    return null
  }

  return (
    <TreeList className='git-change-list git-change-list-flat'>
      <GitChangeRows {...props} />
    </TreeList>
  )
}

export function GitChangeSection({
  title,
  changes,
  kind,
  layout,
  action,
  onStage,
  onUnstage,
  onDiscardMany,
  onOpenDiff,
  onOpenCommitFileDiff,
  onOpenMeoDiff,
  onOpenFile,
  iconTheme,
}: {
  title: string
  changes: GitDisplayChange[]
  kind: GitChangeSectionKind
  layout: GitPanelLayout
  action?: ReactNode
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenCommitFileDiff?: (change: GitCommitFileChange) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  iconTheme: WorkspaceIconTheme | null
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [closedMap, setClosedMap] = useState<Record<string, boolean>>({})
  const treeNodes = useMemo(() => buildGitTree(changes), [changes])
  const rootFiles = useMemo(
    () => changes.filter((change) => !change.relativePath.includes('/')),
    [changes],
  )

  const toggleNode = (id: string) => {
    setClosedMap((previousMap) => ({
      ...previousMap,
      [id]: !previousMap[id],
    }))
  }

  if (changes.length === 0) {
    return null
  }

  return (
    <div className='git-panel-section'>
      <AppItem
        variant='header'
        itemClassName='git-panel-section-header'
        label={title}
        isExpanded={isExpanded}
        info={changes.length}
        actions={action}
        onToggle={() => setIsExpanded((value) => !value)}
      />

      {isExpanded ? (
        <div className={layout === 'tree' ? 'git-panel-tree-shell' : ''}>
          {layout === 'tree' && treeNodes.length > 0 ? (
            <TreeList className='git-change-list'>
              {treeNodes.map((node) => (
                <GitTreeFolder
                  key={node.id}
                  kind={kind}
                  node={node}
                  closedMap={closedMap}
                  toggleNode={toggleNode}
                  onDiscardMany={onDiscardMany}
                  onOpenDiff={onOpenDiff}
                  onOpenCommitFileDiff={onOpenCommitFileDiff}
                  onOpenMeoDiff={onOpenMeoDiff}
                  onOpenFile={onOpenFile}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  iconTheme={iconTheme}
                  layout={layout}
                />
              ))}
              {rootFiles.length > 0 ? (
                <GitChangeRows
                  changes={rootFiles}
                  kind={kind}
                  onDiscardMany={onDiscardMany}
                  onOpenDiff={onOpenDiff}
                  onOpenCommitFileDiff={onOpenCommitFileDiff}
                  onOpenMeoDiff={onOpenMeoDiff}
                  onOpenFile={onOpenFile}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  iconTheme={iconTheme}
                  layout={layout}
                />
              ) : null}
            </TreeList>
          ) : (
            <GitChangeList
              changes={changes}
              kind={kind}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenCommitFileDiff={onOpenCommitFileDiff}
              onOpenMeoDiff={onOpenMeoDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              iconTheme={iconTheme}
              layout={layout}
            />
          )}
        </div>
      ) : null}
    </div>
  )
}
