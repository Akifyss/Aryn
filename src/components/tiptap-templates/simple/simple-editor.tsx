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

import "@/components/tiptap-templates/simple/simple-editor.scss"

export interface SimpleEditorProps {
  disabled?: boolean
  value: string
  onChange: (nextValue: string) => void
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

    <ToolbarGroup>
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
  value,
}: SimpleEditorProps) {
  const isMobile = useIsMobile()
  const { height } = useWindowSize()
  const [mobileView, setMobileView] = React.useState<
    "main" | "highlighter" | "link"
  >("main")
  const [theme, setTheme] = React.useState<"light" | "dark">("light")
  const lastMarkdownRef = React.useRef(value)
  const toolbarRef = React.useRef<HTMLDivElement>(null)

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Main content area, start typing to enter text.",
        class: "simple-editor",
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
    content: "",
    editable: !disabled,
    onCreate: ({ editor: currentEditor }) => {
      const manager = currentEditor.storage.markdown?.manager

      try {
        currentEditor.commands.setContent(
          manager ? manager.parse(value) : value,
          {
            emitUpdate: false,
          }
        )
      } catch {
        currentEditor.commands.setContent(value, {
          emitUpdate: false,
        })
      }

      lastMarkdownRef.current = value
    },
    onUpdate: ({ editor: currentEditor }) => {
      const manager = currentEditor.storage.markdown?.manager
      const nextMarkdown = manager
        ? manager.serialize(currentEditor.getJSON()).replace(/&nbsp;|&#160;/g, " ")
        : currentEditor.getText()

      if (nextMarkdown === lastMarkdownRef.current) {
        return
      }

      lastMarkdownRef.current = nextMarkdown
      onChange(nextMarkdown)
    },
  })

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarRef.current?.getBoundingClientRect().height ?? 0,
  })

  React.useEffect(() => {
    if (!editor) {
      return
    }

    editor.setEditable(!disabled)
  }, [disabled, editor])

  React.useEffect(() => {
    if (!editor || value === lastMarkdownRef.current) {
      return
    }

    const manager = editor.storage.markdown?.manager

    try {
      editor.commands.setContent(manager ? manager.parse(value) : value, {
        emitUpdate: false,
      })
    } catch {
      editor.commands.setContent(value, {
        emitUpdate: false,
      })
    }

    lastMarkdownRef.current = value
  }, [editor, value])

  React.useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main")
    }
  }, [isMobile, mobileView])

  React.useEffect(() => {
    const root = document.documentElement
    root.dataset.tiptapTheme = theme

    return () => {
      delete root.dataset.tiptapTheme
    }
  }, [theme])

  return (
    <div
      className={`simple-editor-wrapper${theme === "dark" ? " dark" : ""}`}
      data-disabled={disabled || undefined}
      data-theme={theme}
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
              onThemeToggle={() =>
                setTheme((currentTheme) =>
                  currentTheme === "dark" ? "light" : "dark"
                )
              }
              theme={theme}
            />
          ) : (
            <MobileToolbarContent
              onBack={() => setMobileView("main")}
              type={mobileView === "highlighter" ? "highlighter" : "link"}
            />
          )}
        </Toolbar>

        <EditorContent
          className="simple-editor-content"
          editor={editor}
          role="presentation"
        />
      </EditorContext.Provider>
    </div>
  )
}
