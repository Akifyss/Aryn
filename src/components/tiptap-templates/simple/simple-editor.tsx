"use client"

import * as React from "react"
import { EditorContent, EditorContext, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import Highlight from "@tiptap/extension-highlight"
import Image from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TextAlign } from "@tiptap/extension-text-align"
import { Typography } from "@tiptap/extension-typography"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import Placeholder from "@tiptap/extension-placeholder"
import { Selection } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"

import { AppScrollArea } from "@/components/app-scroll-area"
import { Button } from "@/components/tiptap-ui-primitive/button"
import { Spacer } from "@/components/tiptap-ui-primitive/spacer"
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/tiptap-ui-primitive/toolbar"

import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension"
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension"
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss"
import "@/components/tiptap-node/code-block-node/code-block-node.scss"
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss"
import "@/components/tiptap-node/list-node/list-node.scss"
import "@/components/tiptap-node/image-node/image-node.scss"
import "@/components/tiptap-node/heading-node/heading-node.scss"
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss"

import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu"
import { ImageUploadButton } from "@/components/tiptap-ui/image-upload-button"
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu"
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button"
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button"
import {
  ColorHighlightPopover,
  ColorHighlightPopoverButton,
  ColorHighlightPopoverContent,
} from "@/components/tiptap-ui/color-highlight-popover"
import {
  LinkPopover,
  LinkButton,
  LinkContent,
} from "@/components/tiptap-ui/link-popover"
import { MarkButton } from "@/components/tiptap-ui/mark-button"
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button"
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button"

import { ArrowLeftIcon } from "@/components/tiptap-icons/arrow-left-icon"
import { HighlighterIcon } from "@/components/tiptap-icons/highlighter-icon"
import { LinkIcon } from "@/components/tiptap-icons/link-icon"

import { useIsMobile } from "@/hooks/use-mobile"
import { useWindowSize } from "@/hooks/use-window-size"
import { useCursorVisibility } from "@/hooks/use-cursor-visibility"

import { ThemeToggle } from "@/components/tiptap-templates/simple/theme-toggle"
import { normalizeMarkdownForComparison } from "@/features/editor/lib/markdown"

import "@/components/tiptap-templates/simple/simple-editor.scss"

export interface SimpleEditorProps {
  disabled?: boolean
  value: string
  onChange: (nextValue: string) => void
  onCompositionChange?: (isComposing: boolean) => void
  theme?: "light" | "dark" | "auto"
}

const MAX_FILE_SIZE = 5 * 1024 * 1024

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }

      reject(new Error("Unable to read image"))
    }

    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read image"))

    reader.readAsDataURL(file)
  })
}

async function uploadImage(
  file: File,
  onProgress?: (event: { progress: number }) => void
) {
  onProgress?.({ progress: 15 })
  const result = await readFileAsDataUrl(file)
  onProgress?.({ progress: 100 })
  return result
}

const MainToolbarContent = ({
  isMobile,
  onHighlighterClick,
  onLinkClick,
  onThemeToggle,
  theme,
}: {
  isMobile: boolean
  onHighlighterClick: () => void
  onLinkClick: () => void
  onThemeToggle: () => void
  theme: "light" | "dark"
}) => (
  <>
    <Spacer />

    <ToolbarGroup>
      <UndoRedoButton action="undo" />
      <UndoRedoButton action="redo" />
    </ToolbarGroup>

    <ToolbarSeparator />

    <ToolbarGroup>
      <HeadingDropdownMenu levels={[1, 2, 3, 4]} portal={isMobile} />
      <ListDropdownMenu
        types={["bulletList", "orderedList", "taskList"]}
        portal={isMobile}
      />
      <BlockquoteButton />
      <CodeBlockButton />
    </ToolbarGroup>

    <ToolbarSeparator />

    <ToolbarGroup>
      <MarkButton type="bold" />
      <MarkButton type="italic" />
      <MarkButton type="strike" />
      <MarkButton type="code" />
      <MarkButton type="underline" />
      {!isMobile ? (
        <ColorHighlightPopover />
      ) : (
        <ColorHighlightPopoverButton onClick={onHighlighterClick} />
      )}
      {!isMobile ? <LinkPopover /> : <LinkButton onClick={onLinkClick} />}
    </ToolbarGroup>

    <ToolbarSeparator />

    <ToolbarGroup>
      <MarkButton type="superscript" />
      <MarkButton type="subscript" />
    </ToolbarGroup>

    <ToolbarSeparator />

    <ToolbarGroup>
      <TextAlignButton align="left" />
      <TextAlignButton align="center" />
      <TextAlignButton align="right" />
      <TextAlignButton align="justify" />
    </ToolbarGroup>

    <ToolbarSeparator />

    <ToolbarGroup>
      <ImageUploadButton text="Add" />
    </ToolbarGroup>

    <Spacer />

    {isMobile && <ToolbarSeparator />}

    <ToolbarGroup className="tiptap-theme-toggle-group">
      <ThemeToggle theme={theme} onToggle={onThemeToggle} />
    </ToolbarGroup>
  </>
)

const MobileToolbarContent = ({
  onBack,
  type,
}: {
  onBack: () => void
  type: "highlighter" | "link"
}) => (
  <>
    <ToolbarGroup>
      <Button data-style="ghost" onClick={onBack}>
        <ArrowLeftIcon className="tiptap-button-icon" />
        {type === "highlighter" ? (
          <HighlighterIcon className="tiptap-button-icon" />
        ) : (
          <LinkIcon className="tiptap-button-icon" />
        )}
      </Button>
    </ToolbarGroup>

    <ToolbarSeparator />

    {type === "highlighter" ? (
      <ColorHighlightPopoverContent />
    ) : (
      <LinkContent />
    )}
  </>
)

export function SimpleEditor({
  disabled = false,
  onChange,
  onCompositionChange,
  value,
  theme = "auto",
}: SimpleEditorProps) {
  const isMobile = useIsMobile()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = React.useState<
    "main" | "highlighter" | "link"
  >("main")
  
  // Resolve theme from prop or system preference
  const resolvedTheme = React.useMemo(() => {
    if (theme === "auto") {
      return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return theme
  }, [theme])

  const lastMarkdownRef = React.useRef(normalizeMarkdownForComparison(value))
  const onChangeRef = React.useRef(onChange)
  const onCompositionChangeRef = React.useRef(onCompositionChange)
  const isComposingRef = React.useRef(false)
  const isFocusedRef = React.useRef(false)
  const pendingMarkdownRef = React.useRef<string | null>(null)
  const compositionFlushTimerRef = React.useRef<number | null>(null)
  const toolbarRef = React.useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = React.useState(false)

  const emitMarkdownChange = React.useCallback((nextMarkdown: string) => {
    const comparableMarkdown = normalizeMarkdownForComparison(nextMarkdown)

    if (comparableMarkdown === lastMarkdownRef.current) {
      return
    }

    lastMarkdownRef.current = comparableMarkdown
    onChangeRef.current(nextMarkdown)
  }, [])

  React.useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  React.useEffect(() => {
    onCompositionChangeRef.current = onCompositionChange
  }, [onCompositionChange])

  const editor = useEditor({
    immediatelyRender: false,
    content: value,
    contentType: "markdown",
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Main content area, start typing to enter text.",
        class: "simple-editor",
      },
      handleDOMEvents: {
        compositionstart: () => {
          if (compositionFlushTimerRef.current !== null) {
            window.clearTimeout(compositionFlushTimerRef.current)
            compositionFlushTimerRef.current = null
          }

          isComposingRef.current = true
          onCompositionChangeRef.current?.(true)
          return false
        },
        compositionend: () => {
          isComposingRef.current = false
          onCompositionChangeRef.current?.(false)
          compositionFlushTimerRef.current = window.setTimeout(() => {
            compositionFlushTimerRef.current = null
            flushPendingComposition()
          }, 0)
          return false
        },
        focus: () => {
          isFocusedRef.current = true
          setIsFocused(true)
          return false
        },
        blur: () => {
          isFocusedRef.current = false
          setIsFocused(false)
          return false
        },
      },
    },
    extensions: [
      StarterKit.configure({
        horizontalRule: false,
        link: {
          openOnClick: false,
          enableClickSelection: true,
          autolink: true,
          defaultProtocol: "https",
        },
      }),
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Image.configure({ allowBase64: true }),
      Typography,
      Superscript,
      Subscript,
      Selection,
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: uploadImage,
      }),
      Markdown,
    ],
    editable: !disabled,
    onUpdate: ({ editor: currentEditor }) => {
      const nextMarkdown = currentEditor.getMarkdown()

      if (isComposingRef.current) {
        pendingMarkdownRef.current = nextMarkdown
        return
      }

      emitMarkdownChange(nextMarkdown)
    },
  })

  const flushPendingComposition = React.useCallback(() => {
    if (!editor) {
      return
    }

    const nextMarkdown = pendingMarkdownRef.current ?? editor.getMarkdown()
    pendingMarkdownRef.current = null
    emitMarkdownChange(nextMarkdown)
  }, [editor, emitMarkdownChange])

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  React.useEffect(() => {
    if (!editor) {
      return
    }

    editor.setEditable(!disabled, false)
  }, [disabled, editor])

  React.useEffect(() => {
    const comparableValue = normalizeMarkdownForComparison(value)

    if (!editor) {
      return
    }

    const currentEditorValue = normalizeMarkdownForComparison(editor.getMarkdown())

    if (comparableValue === currentEditorValue) {
      lastMarkdownRef.current = comparableValue
      return
    }

    if (isComposingRef.current || isFocusedRef.current || comparableValue === lastMarkdownRef.current) {
      return
    }

    try {
      editor.commands.setContent(value, {
        contentType: "markdown",
        emitUpdate: false,
      })
    } catch {
      editor.commands.setContent(value, {
        emitUpdate: false,
      })
    }

    lastMarkdownRef.current = comparableValue
  }, [editor, isFocused, value])

  React.useEffect(() => () => {
    if (compositionFlushTimerRef.current !== null) {
      window.clearTimeout(compositionFlushTimerRef.current)
    }

    pendingMarkdownRef.current = null
    isFocusedRef.current = false
    isComposingRef.current = false
    onCompositionChangeRef.current?.(false)
  }, [])

  React.useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main")
    }
  }, [isMobile, mobileView])

  React.useEffect(() => {
    const root = document.documentElement
    root.dataset.tiptapTheme = resolvedTheme

    return () => {
      delete root.dataset.tiptapTheme
    }
  }, [resolvedTheme])

  return (
    <div
      className={`simple-editor-wrapper${resolvedTheme === "dark" ? " dark" : ""}`}
      data-disabled={disabled || undefined}
      data-theme={resolvedTheme}
    >
      <EditorContext.Provider value={{ editor }}>
        <Toolbar
          ref={toolbarRef}
          style={{
            ...(isMobile
              ? {
                  bottom: `calc(100% - ${height - rect.y}px)`,
                }
              : {}),
          }}
        >
          {mobileView === "main" ? (
            <MainToolbarContent
              isMobile={isMobile}
              onHighlighterClick={() => setMobileView("highlighter")}
              onLinkClick={() => setMobileView("link")}
              onThemeToggle={() => {}} // Controlled globally
              theme={resolvedTheme}
            />
          ) : (
            <MobileToolbarContent
              onBack={() => setMobileView("main")}
              type={mobileView === "highlighter" ? "highlighter" : "link"}
            />
          )}
        </Toolbar>

        <AppScrollArea
          className="simple-editor-content"
          contentClassName="simple-editor-content-inner"
          viewportClassName="simple-editor-viewport"
        >
          <EditorContent
            className="simple-editor-editor"
            editor={editor}
            role="presentation"
          />
        </AppScrollArea>
      </EditorContext.Provider>
    </div>
  )
}
