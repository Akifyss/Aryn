import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react'
import { Drawer } from '@heroui/react'
import { LayoutRightLine } from '@mingcute/react'
import { AppTitlebar } from '@/components/app-titlebar'
import { AppTooltipButton } from '@/components/app-tooltip'
import type { useShellLayoutController } from '@/features/layout/hooks/use-shell-layout-controller'
import { getShellChromeOverlayState } from '@/features/layout/shell-layout'
import './styles.css'

type AppShellLayout = Pick<
  ReturnType<typeof useShellLayoutController>,
  | 'activeResizePanel'
  | 'appShellRef'
  | 'drawerDragRegion'
  | 'effectiveAgentChatTrackWidth'
  | 'effectiveAgentEditorTrackWidth'
  | 'effectiveLeftSidebarWidth'
  | 'effectiveRightSidebarWidth'
  | 'handleLeftDrawerOpenChange'
  | 'handleResizeKeyDown'
  | 'handleResizeStart'
  | 'handleRightDrawerOpenChange'
  | 'handleSidebarLayoutTransitionEnd'
  | 'isLeftDrawerOpen'
  | 'isLeftSidebarDrawer'
  | 'isLeftSidebarVisible'
  | 'isRightDrawerFullWidth'
  | 'isRightDrawerOpen'
  | 'isRightSidebarDrawer'
  | 'isRightSidebarVisible'
  | 'isWindowFullScreen'
  | 'layoutMode'
  | 'leftSidebarResizeBounds'
  | 'renderedEditorRightSidebarWidth'
  | 'renderedLeftSidebarWidth'
  | 'rightDrawerOverlayRoot'
  | 'rightDrawerSurfaceRef'
  | 'rightSidebarResizeBounds'
  | 'setRightDrawerOverlayRoot'
  | 'shellChromeVars'
  | 'shellPlatform'
  | 'toggleAssistantSurface'
>

type AppShellProps = {
  appLayout: 'agent' | 'editor'
  children?: ReactNode
  isDarkTheme: boolean
  isModalLayerOpen: boolean
  layout: AppShellLayout
  layoutModeSwitch: ReactNode
  leftChromeSearchAction: ReactNode
  leftChromeSidebarAction: ReactNode
  onRequestWindowClose: () => void
  renderCenterPanel: () => ReactNode
  renderLeftSidebar: (surfaceMode: 'docked' | 'drawer') => ReactNode
  renderRightDrawerOverlay: (frameRect: DOMRect | null) => ReactNode
  renderRightPanel: (surfaceMode: 'docked' | 'drawer') => ReactNode
  rightCollapsedActions?: ReactNode
  shouldExposeRightPanelTools: boolean
}

export function AppShell({
  appLayout,
  children,
  isDarkTheme,
  isModalLayerOpen,
  layout,
  layoutModeSwitch,
  leftChromeSearchAction,
  leftChromeSidebarAction,
  onRequestWindowClose,
  renderCenterPanel,
  renderLeftSidebar,
  renderRightDrawerOverlay,
  renderRightPanel,
  rightCollapsedActions,
  shouldExposeRightPanelTools,
}: AppShellProps) {
  const {
    activeResizePanel,
    appShellRef,
    drawerDragRegion,
    effectiveAgentChatTrackWidth,
    effectiveAgentEditorTrackWidth,
    effectiveLeftSidebarWidth,
    effectiveRightSidebarWidth,
    handleLeftDrawerOpenChange,
    handleResizeKeyDown,
    handleResizeStart,
    handleRightDrawerOpenChange,
    handleSidebarLayoutTransitionEnd,
    isLeftDrawerOpen,
    isLeftSidebarDrawer,
    isLeftSidebarVisible,
    isRightDrawerFullWidth,
    isRightDrawerOpen,
    isRightSidebarDrawer,
    isRightSidebarVisible,
    isWindowFullScreen,
    layoutMode,
    leftSidebarResizeBounds,
    renderedEditorRightSidebarWidth,
    renderedLeftSidebarWidth,
    rightDrawerOverlayRoot,
    rightDrawerSurfaceRef,
    rightSidebarResizeBounds,
    setRightDrawerOverlayRoot,
    shellChromeVars,
    shellPlatform,
    toggleAssistantSurface,
  } = layout
  const isAgentLayout = appLayout === 'agent'
  const leftChromeSurface = isLeftDrawerOpen
    ? 'drawer'
    : isLeftSidebarVisible
      ? 'docked'
      : 'collapsed'
  const shellChromeOverlayState = getShellChromeOverlayState({
    isLeftDrawerOpen,
    isModalLayerOpen,
    isRightDrawerOpen,
  })
  const shellStyle = {
    '--agent-chat-track-width': `${effectiveAgentChatTrackWidth}px`,
    '--agent-editor-track-width': `${effectiveAgentEditorTrackWidth}px`,
    '--left-sidebar-content-width': `${renderedLeftSidebarWidth}px`,
    '--left-sidebar-width': `${effectiveLeftSidebarWidth}px`,
    '--right-sidebar-content-width': `${renderedEditorRightSidebarWidth}px`,
    '--right-sidebar-width': `${effectiveRightSidebarWidth}px`,
    ...shellChromeVars,
  } as CSSProperties
  const rightSidebarToggleAriaLabel = isRightSidebarDrawer
    ? (isRightDrawerOpen ? 'Close assistant panel' : 'Open assistant panel')
    : (isRightSidebarVisible ? 'Collapse assistant sidebar' : 'Expand assistant sidebar')
  const rightSidebarToggleTooltip = isRightSidebarDrawer
    ? (isRightDrawerOpen ? '关闭抽屉' : '打开抽屉')
    : (isRightSidebarVisible ? '收起侧边栏' : '展开侧边栏')
  const leftChromeControls = (
    <div
      className='left-chrome-actions'
      data-left-surface={leftChromeSurface}
      data-overlay-elevated={shellChromeOverlayState.leftControlsElevated ? 'true' : 'false'}
      data-react-aria-top-layer={shellChromeOverlayState.leftControlsTopLayer ? 'true' : undefined}
    >
      {layoutModeSwitch}
      {!isLeftDrawerOpen ? (
        <>
          {isLeftSidebarVisible ? <div className='left-chrome-drag-spacer' aria-hidden='true' /> : null}
          {leftChromeSearchAction}
          {leftChromeSidebarAction}
        </>
      ) : null}
    </div>
  )

  const handleResizePointerDown = (
    panel: 'left' | 'right',
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    handleResizeStart(panel)
  }

  return (
    <div
      ref={appShellRef}
      className='app-shell'
      data-app-layout={appLayout}
      data-layout={layoutMode}
      data-platform={shellPlatform}
      data-left-collapsed={isLeftSidebarDrawer || !isLeftSidebarVisible ? 'true' : 'false'}
      data-left-drawer-open={isLeftDrawerOpen ? 'true' : 'false'}
      data-modal-layer-open={isModalLayerOpen ? 'true' : 'false'}
      data-resizing={activeResizePanel ? 'true' : 'false'}
      data-right-collapsed={isRightSidebarDrawer || !isRightSidebarVisible ? 'true' : 'false'}
      data-right-drawer-open={isRightDrawerOpen ? 'true' : 'false'}
      data-window-fullscreen={isWindowFullScreen ? 'true' : 'false'}
      onTransitionEnd={handleSidebarLayoutTransitionEnd}
      style={shellStyle}
    >
      {isAgentLayout && shouldExposeRightPanelTools && !isRightSidebarVisible && rightCollapsedActions ? (
        <div
          className='agent-collapsed-tab-actions'
          data-overlay-elevated={shellChromeOverlayState.rightControlsElevated ? 'true' : 'false'}
          data-react-aria-top-layer={shellChromeOverlayState.rightControlsTopLayer ? 'true' : undefined}
        >
          {rightCollapsedActions}
        </div>
      ) : null}

      {shouldExposeRightPanelTools ? (
        <AppTooltipButton
          type='button'
          className='panel-toggle-button panel-toggle-button-overlay panel-toggle-button-overlay-right'
          data-overlay-elevated={shellChromeOverlayState.rightControlsElevated ? 'true' : 'false'}
          data-react-aria-top-layer={shellChromeOverlayState.rightControlsTopLayer ? 'true' : undefined}
          aria-label={rightSidebarToggleAriaLabel}
          tooltip={rightSidebarToggleTooltip}
          preventFocusOnPress
          onClick={toggleAssistantSurface}
        >
          <span className='panel-toggle-icon' aria-hidden='true'>
            <LayoutRightLine size={16} />
          </span>
        </AppTooltipButton>
      ) : null}

      {!isLeftSidebarDrawer ? (
        <aside
          id='workspace-sidebar-panel'
          className={`panel panel-sidebar${isLeftSidebarVisible ? '' : ' is-collapsed'}`}
          aria-hidden={isLeftSidebarVisible ? undefined : true}
          inert={isLeftSidebarVisible ? undefined : true}
        >
          {renderLeftSidebar('docked')}
        </aside>
      ) : null}

      <div className={`panel-resize-slot panel-resize-slot-left${isLeftSidebarVisible ? '' : ' is-hidden'}`}>
        <div
          role='separator'
          tabIndex={0}
          className={`panel-resize-handle${activeResizePanel === 'left' ? ' is-active' : ''}`}
          aria-label='Resize workspace sidebar'
          aria-controls='workspace-sidebar-panel'
          aria-orientation='vertical'
          aria-valuemin={leftSidebarResizeBounds.min}
          aria-valuemax={leftSidebarResizeBounds.max}
          aria-valuenow={leftSidebarResizeBounds.value}
          onKeyDown={(event) => handleResizeKeyDown('left', event)}
          onPointerDown={(event) => handleResizePointerDown('left', event)}
        />
      </div>

      <main className='panel panel-editor' id='editor-main'>
        {renderCenterPanel()}
      </main>

      <div className={`panel-resize-slot panel-resize-slot-right${isRightSidebarVisible ? '' : ' is-hidden'}`}>
        <div
          role='separator'
          tabIndex={0}
          className={`panel-resize-handle${activeResizePanel === 'right' ? ' is-active' : ''}`}
          aria-label={isAgentLayout ? 'Resize Agent chat panel' : 'Resize assistant sidebar'}
          aria-controls={isAgentLayout ? 'editor-main' : 'assistant-sidebar-panel'}
          aria-orientation='vertical'
          aria-valuemin={rightSidebarResizeBounds.min}
          aria-valuemax={rightSidebarResizeBounds.max}
          aria-valuenow={rightSidebarResizeBounds.value}
          onKeyDown={(event) => handleResizeKeyDown('right', event)}
          onPointerDown={(event) => handleResizePointerDown('right', event)}
        />
      </div>

      {!isRightSidebarDrawer && shouldExposeRightPanelTools ? (
        <aside
          id='assistant-sidebar-panel'
          className={`panel panel-agent${isRightSidebarVisible ? '' : ' is-collapsed'}`}
          aria-hidden={isRightSidebarVisible ? undefined : true}
          inert={isRightSidebarVisible ? undefined : true}
        >
          {renderRightPanel('docked')}
        </aside>
      ) : null}

      {isLeftSidebarDrawer ? (
        <Drawer
          isOpen={isLeftDrawerOpen}
          onOpenChange={handleLeftDrawerOpenChange}
        >
          <Drawer.Backdrop
            className='panel-drawer-backdrop'
            variant='opaque'
          >
            <Drawer.Content placement='left' className='panel-drawer panel-drawer-left' data-platform={shellPlatform}>
              <Drawer.Dialog
                aria-label='Workspace'
                className={`panel-drawer-dialog${isDarkTheme ? ' dark' : ''}`}
              >
                <Drawer.Body className='panel-drawer-body'>
                  {renderLeftSidebar('drawer')}
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      ) : null}

      {isRightSidebarDrawer ? (
        <Drawer
          isOpen={isRightDrawerOpen}
          onOpenChange={handleRightDrawerOpenChange}
        >
          <Drawer.Backdrop
            className='panel-drawer-backdrop'
            variant='opaque'
          >
            <Drawer.Content placement='right' className='panel-drawer panel-drawer-right' data-platform={shellPlatform}>
              <Drawer.Dialog
                aria-label='Assistant'
                className={`panel-drawer-dialog${isDarkTheme ? ' dark' : ''}`}
              >
                <Drawer.Body className='panel-drawer-body panel-drawer-body-agent'>
                  <div
                    ref={rightDrawerSurfaceRef}
                    className='panel panel-agent panel-agent-drawer'
                    data-agent-editor-surface={isAgentLayout ? 'true' : 'false'}
                    data-full-width={isRightDrawerFullWidth ? 'true' : 'false'}
                    data-platform={shellPlatform}
                    style={shellChromeVars}
                  >
                    {renderRightPanel('drawer')}
                    <div ref={setRightDrawerOverlayRoot} className='drawer-local-overlay-root'>
                      {renderRightDrawerOverlay(
                        rightDrawerOverlayRoot?.getBoundingClientRect() ?? null,
                      )}
                    </div>
                  </div>
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      ) : null}

      {drawerDragRegion ? (
        <div
          aria-hidden='true'
          className='drawer-window-drag-region'
          data-react-aria-top-layer='true'
          style={{
            height: `${drawerDragRegion.height}px`,
            left: `${drawerDragRegion.left}px`,
            top: `${drawerDragRegion.top}px`,
            width: `${drawerDragRegion.width}px`,
          }}
        />
      ) : null}

      {children}

      <AppTitlebar
        isDrawerOpen={isLeftDrawerOpen || isRightDrawerOpen}
        isLeftDrawerOpen={isLeftDrawerOpen}
        leftControls={leftChromeControls}
        onRequestClose={onRequestWindowClose}
      />
    </div>
  )
}
