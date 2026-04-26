import {EditorView} from "@codemirror/view"
import {StyleModule} from "style-mod"

export const externalTheme = EditorView.styleModule.of(new StyleModule({
  ".cm-mergeView": {
    overflowY: "auto",
  },
  ".cm-mergeViewEditors": {
    display: "flex",
    alignItems: "stretch",
  },
  ".cm-mergeViewEditor": {
    flexGrow: 1,
    flexBasis: 0,
    overflow: "hidden"
  },
  ".cm-merge-revert": {
    width: "1.6em",
    flexGrow: 0,
    flexShrink: 0,
    position: "relative"
  },
  ".cm-merge-revert button": {
    position: "absolute",
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    textAlign: "center",
    background: "none",
    border: "none",
    font: "inherit",
    cursor: "pointer"
  }
}))

export const baseTheme = EditorView.baseTheme({
  ".cm-mergeView & .cm-scroller, .cm-mergeView &": {
    height: "auto !important",
    overflowY: "visible !important"
  },

  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
    backgroundColor: "rgba(160, 128, 100, .08)"
  },
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(100, 160, 128, .08)"
  },

  "&light.cm-merge-a .cm-changedText, &light .cm-deletedChunk .cm-deletedText": {
    background: "#ee443344",
    borderRadius: "2px",
  },

  "&dark.cm-merge-a .cm-changedText, &dark .cm-deletedChunk .cm-deletedText": {
    background: "#ffaa9944",
    borderRadius: "2px",
  },

  "&light.cm-merge-b .cm-changedText": {
    background: "#22bb2244",
    borderRadius: "2px",
  },

  "&dark.cm-merge-b .cm-changedText": {
    background: "#88ff8844",
    borderRadius: "2px",
  },

  ".cm-changedTextEmpty": {
    display: "inline-block",
    position: "relative",
    width: 0,
    height: "1.05em",
    verticalAlign: "-0.12em",
  },

  ".cm-changedTextEmpty::after": {
    content: '""',
    position: "absolute",
    left: "-1px",
    top: 0,
    width: "2px",
    height: "100%",
    borderRadius: "999px",
  },

  "&light.cm-merge-a .cm-changedTextEmpty::after": {
    background: "#ee443377",
  },

  "&dark.cm-merge-a .cm-changedTextEmpty::after": {
    background: "#ffaa9977",
  },

  "&light.cm-merge-b .cm-changedTextEmpty::after": {
    background: "#22bb2277",
  },

  "&dark.cm-merge-b .cm-changedTextEmpty::after": {
    background: "#88ff8877",
  },

  "&.cm-merge-b .cm-deletedText": {
    background: "#ff000033"
  },

  ".cm-insertedLine, .cm-deletedLine, .cm-deletedLine del": {
    textDecoration: "none"
  },

  ".cm-deletedChunk": {
    paddingLeft: "6px",
    "& .cm-chunkButtons": {
      position: "absolute",
      insetInlineEnd: "5px"
    },
    "& button": {
      border: "none",
      cursor: "pointer",
      color: "white",
      margin: "0 2px",
      borderRadius: "3px",
      "&[name=accept]": { background: "#2a2" },
      "&[name=reject]": { background: "#d43" }
    },
  },

  ".cm-insertedChunkHost": {
    backgroundColor: "transparent",
  },

  ".cm-collapsedLines": {
    padding: "5px 5px 5px 10px",
    cursor: "pointer",
    "&:before": {
      content: '"⦚"',
      marginInlineEnd: "7px"
    },
    "&:after": {
      content: '"⦚"',
      marginInlineStart: "7px"
    },
  },
  "&light .cm-collapsedLines": {
    color: "#444",
    background: "linear-gradient(to bottom, transparent 0, #f3f3f3 30%, #f3f3f3 70%, transparent 100%)"
  },
  "&dark .cm-collapsedLines": {
    color: "#ddd",
    background: "linear-gradient(to bottom, transparent 0, #222 30%, #222 70%, transparent 100%)"
  },

  ".cm-changeGutter": { width: "3px", paddingLeft: "1px" },
  "&light.cm-merge-a .cm-changedLineGutter, &light .cm-deletedLineGutter": { background: "#e43" },
  "&dark.cm-merge-a .cm-changedLineGutter, &dark .cm-deletedLineGutter": { background: "#fa9" },
  "&light.cm-merge-b .cm-changedLineGutter": { background: "#2b2" },
  "&dark.cm-merge-b .cm-changedLineGutter": { background: "#8f8" },
  ".cm-inlineChangedLineGutter": { background: "#75d" }
})
