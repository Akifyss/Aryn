"use client"

import * as React from "react"
import { EditorContent, EditorContext, useEditor } from "@tiptap/react"
import { StarterKit } from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TextAlign } from "@tiptap/extension-text-align"
import { Typography } from "@tiptap/extension-typography"
import { Subscript } from "@tiptap/extension-subscript"
import { Superscript } from "@tiptap/extension-superscript"
import { Underline } from "@tiptap/extension-underline"
import Placeholder from "@tiptap/extension-placeholder"
import { Markdown } from "@tiptap/markdown"
import { ScrollShadow } from "@heroui/react"

import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/tiptap-ui-primitive/toolbar"

import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension"

import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu"
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu"
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button"
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button"
import { LinkPopover } from "@/components/tiptap-ui/link-popover"
import { MarkButton } from "@/components/tiptap-ui/mark-button"
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button"
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button"

import "@/components/tiptap-templates/simple/simple-editor.scss"

export interface SimpleEditorProps {
  disabled?: boolean
  value: string
  onChange: (nextValue: string) => void
}

export function SimpleEditor({
  disabled = false,
  onChange,
  value,
}: SimpleEditorProps) {
  const lastMarkdownRef = React.useRef(value)

  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Markdown editor",
        class: "simple-editor",
      },
    },
    extensions: [
      StarterKit.configure({
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        enableClickSelection: true,
        autolink: true,
        defaultProtocol: "https",
      }),
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Typography,
      Underline,
      Superscript,
      Subscript,
      Placeholder.configure({
        placeholder: "Start writing in Markdown...",
      }),
      Markdown,
    ],
    content: "",
    editable: !disabled,
    onCreate: ({ editor }) => {
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
    },
    onUpdate: ({ editor }) => {
      const manager = editor.storage.markdown?.manager
      const nextMarkdown = manager
        ? manager.serialize(editor.getJSON()).replace(/&nbsp;|&#160;/g, " ")
        : editor.getText()

      if (nextMarkdown === lastMarkdownRef.current) {
        return
      }

      lastMarkdownRef.current = nextMarkdown
      onChange(nextMarkdown)
    },
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

  return (
    <div className="simple-editor-wrapper" data-disabled={disabled || undefined}>
      <EditorContext.Provider value={{ editor }}>
        <ScrollShadow
          className="awa-simple-toolbar-scroll"
          hideScrollBar
          offset={24}
          orientation="horizontal"
          size={48}
        >
          <div className="awa-simple-toolbar-frame">
            <Toolbar className="awa-simple-toolbar">
              <ToolbarGroup>
                <UndoRedoButton action="undo" showTooltip={false} />
                <UndoRedoButton action="redo" showTooltip={false} />
              </ToolbarGroup>

              <ToolbarSeparator />

              <ToolbarGroup>
                <HeadingDropdownMenu levels={[1, 2, 3, 4]} />
                <ListDropdownMenu
                  types={["bulletList", "orderedList", "taskList"]}
                />
                <BlockquoteButton showTooltip={false} />
                <CodeBlockButton showTooltip={false} />
              </ToolbarGroup>

              <ToolbarSeparator />

              <ToolbarGroup>
                <MarkButton type="bold" showTooltip={false} />
                <MarkButton type="italic" showTooltip={false} />
                <MarkButton type="strike" showTooltip={false} />
                <MarkButton type="code" showTooltip={false} />
                <MarkButton type="underline" showTooltip={false} />
                <LinkPopover />
              </ToolbarGroup>

              <ToolbarSeparator />

              <ToolbarGroup>
                <MarkButton type="superscript" showTooltip={false} />
                <MarkButton type="subscript" showTooltip={false} />
              </ToolbarGroup>

              <ToolbarSeparator />

              <ToolbarGroup>
                <TextAlignButton align="left" showTooltip={false} />
                <TextAlignButton align="center" showTooltip={false} />
                <TextAlignButton align="right" showTooltip={false} />
                <TextAlignButton align="justify" showTooltip={false} />
              </ToolbarGroup>
            </Toolbar>
          </div>
        </ScrollShadow>

        <EditorContent
          editor={editor}
          role="presentation"
          className="simple-editor-content"
        />
      </EditorContext.Provider>
    </div>
  )
}
