import {
  type ReactNode,
  type RefObject,
  useCallback,
  useMemo,
  useState,
} from 'react'
import fileExportIcon from '@iconify-icons/material-symbols/file-export-outline-rounded'
import minusIcon from '@iconify-icons/mdi/minus'
import { Icon as OfflineIcon } from '@iconify/react/offline'
import { AddLine, Back2Line, MarkdownLine } from '@mingcute/react'
import {
  FileChangeStatusBadge,
  WorkspaceFileIcon,
} from '@/components/file-change-visuals'
import {
  AppItem,
  AppItemActionButton,
} from '@/components/app-item'
import {
  DEFAULT_TREE_ROW_SIZE,
  DESCRIBED_TREE_ROW_SIZE,
  VirtualizedTreeList,
  type VirtualizedTreeRowAriaMetadata,
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
import {
  createGitChangeTreeRows,
  type GitChangeTreeRow,
} from './git-change-tree-model'
import './styles.css'

type GitChangeSectionKind = 'staged' | 'unstaged' | 'pulled' | 'commit'

export type GitChangeRowProps = {
  change: GitDisplayChange
  iconTheme: WorkspaceIconTheme | null
  kind: GitChangeSectionKind
  layout: GitPanelLayout
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenCommitFileDiff?: (change: GitCommitFileChange) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
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
      {showOpenFile ? (
        <AppItemActionButton
          aria-label='打开文件'
          title='打开文件'
          onClick={(event) => {
            event.stopPropagation()
            onOpenFile?.()
          }}
        >
          <OfflineIcon icon={fileExportIcon} aria-hidden='true' />
        </AppItemActionButton>
      ) : null}
      {showMeoDiff ? (
        <AppItemActionButton
          aria-label='打开 MEO 分屏差异'
          title='打开 MEO 分屏差异'
          onClick={(event) => {
            event.stopPropagation()
            onOpenMeoDiff?.()
          }}
        >
          <MarkdownLine aria-hidden='true' />
        </AppItemActionButton>
      ) : null}
      {showUnstage ? (
        <AppItemActionButton
          aria-label='取消暂存'
          title='取消暂存'
          onClick={(event) => {
            event.stopPropagation()
            onUnstage?.()
          }}
        >
          <OfflineIcon icon={minusIcon} aria-hidden='true' />
        </AppItemActionButton>
      ) : null}
      {showStageControls ? (
        <>
          <AppItemActionButton
            aria-label='放弃更改'
            title='放弃更改'
            onClick={(event) => {
              event.stopPropagation()
              onDiscard?.()
            }}
          >
            <Back2Line aria-hidden='true' />
          </AppItemActionButton>
          <AppItemActionButton
            aria-label='暂存'
            title='暂存'
            onClick={(event) => {
              event.stopPropagation()
              onStage?.()
            }}
          >
            <AddLine aria-hidden='true' />
          </AppItemActionButton>
        </>
      ) : null}
    </>
  )
}

function GitTreeFolderRow({
  closedMap,
  iconTheme,
  kind,
  node,
  onDiscardMany,
  onStage,
  onToggle,
  onUnstage,
}: {
  closedMap: Readonly<Record<string, boolean>>
  iconTheme: WorkspaceIconTheme | null
  kind: GitChangeSectionKind
  node: GitTreeNode
  onDiscardMany: (changes: GitChangeItem[]) => void
  onStage: (filePaths: string[]) => void
  onToggle: (id: string) => void
  onUnstage: (filePaths: string[]) => void
}) {
  const isClosed = closedMap[node.id] ?? false
  const activeItems = node.items.filter(isScopedGitChange)
  const paths = activeItems.map((item) => item.path)

  return (
    <AppItem
      itemAs='div'
      icon={(
        <WorkspaceFileIcon
          isFolder
          nodeLabel={node.label}
          isClosed={isClosed}
          iconTheme={iconTheme}
        />
      )}
      label={node.label}
      mainButtonProps={{
        'aria-expanded': !isClosed,
        onClick: () => onToggle(node.id),
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

export function GitChangeRow({
  change,
  iconTheme,
  kind,
  layout,
  onDiscardMany,
  onOpenCommitFileDiff,
  onOpenDiff,
  onOpenFile,
  onOpenMeoDiff,
  onStage,
  onUnstage,
}: GitChangeRowProps) {
  const fileName = getBaseName(change.relativePath)
  const dirLabel = getDirectoryLabel(change.relativePath)
  const isChange = isScopedGitChange(change)
  const pathMeta = layout === 'list' ? dirLabel : ''
  const changeKindLabel = getGitChangeKindLabel(change.kind)

  return (
    <AppItem
      itemAs='div'
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
          onDiscard={() => isChange && onDiscardMany([change])}
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
}

function getRowAriaMetadata(row: GitChangeTreeRow): VirtualizedTreeRowAriaMetadata {
  return row.aria
}

function getRowDepth(row: GitChangeTreeRow) {
  return row.depth
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
  scrollElementRef,
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
  scrollElementRef: RefObject<HTMLDivElement | null>
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [closedMap, setClosedMap] = useState<Record<string, boolean>>({})
  const treeNodes = useMemo(
    () => layout === 'tree' ? buildGitTree(changes) : [],
    [changes, layout],
  )
  const rows = useMemo(
    () => createGitChangeTreeRows(changes, layout, closedMap, treeNodes),
    [changes, closedMap, layout, treeNodes],
  )
  const estimateRowSize = useCallback((row: GitChangeTreeRow) => {
    if (row.kind === 'folder' || layout === 'tree') return DEFAULT_TREE_ROW_SIZE

    return getDirectoryLabel(row.change.relativePath)
      ? DESCRIBED_TREE_ROW_SIZE
      : DEFAULT_TREE_ROW_SIZE
  }, [layout])
  const toggleNode = useCallback((id: string) => {
    setClosedMap((previousMap) => ({
      ...previousMap,
      [id]: !previousMap[id],
    }))
  }, [])

  if (changes.length === 0) return null

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
          <VirtualizedTreeList
            ariaLabel={title}
            estimateRowSize={estimateRowSize}
            getRowAriaMetadata={getRowAriaMetadata}
            getRowDepth={getRowDepth}
            indentSize={22}
            itemClassName='git-change-virtual-item'
            listClassName='git-change-list'
            renderRow={(row) => row.kind === 'folder' ? (
              <GitTreeFolderRow
                closedMap={closedMap}
                iconTheme={iconTheme}
                kind={kind}
                node={row.node}
                onDiscardMany={onDiscardMany}
                onStage={onStage}
                onToggle={toggleNode}
                onUnstage={onUnstage}
              />
            ) : (
              <GitChangeRow
                change={row.change}
                iconTheme={iconTheme}
                kind={kind}
                layout={layout}
                onDiscardMany={onDiscardMany}
                onOpenCommitFileDiff={onOpenCommitFileDiff}
                onOpenDiff={onOpenDiff}
                onOpenFile={onOpenFile}
                onOpenMeoDiff={onOpenMeoDiff}
                onStage={onStage}
                onUnstage={onUnstage}
              />
            )}
            rows={rows}
            scrollElementRef={scrollElementRef}
          />
        </div>
      ) : null}
    </div>
  )
}
