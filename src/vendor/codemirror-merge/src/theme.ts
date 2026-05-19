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

  "&.cm-merge-emptySide": {
    minHeight: "0 !important",
  },
  "&.cm-merge-emptySide .cm-scroller": {
    minHeight: "0 !important",
  },
  "&.cm-merge-emptySide .cm-content": {
    lineHeight: "0 !important",
    minHeight: "0 !important",
    paddingTop: "0 !important",
    paddingBottom: "0 !important",
  },
  "&.cm-merge-emptySide .cm-line": {
    height: "0 !important",
    minHeight: "0 !important",
    padding: "0 !important",
    overflow: "hidden",
    lineHeight: "0 !important",
  },
  "&.cm-merge-emptySide .cm-line::selection": {
    background: "transparent",
  },
  "&.cm-merge-emptySide .cm-lineNumbers .cm-gutterElement, &.cm-merge-emptySide .cm-gutterElement.cm-activeLineGutter": {
    height: "0 !important",
    minHeight: "0 !important",
    paddingTop: "0 !important",
    paddingBottom: "0 !important",
    overflow: "hidden",
    color: "transparent !important",
    lineHeight: "0 !important",
  },

  "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
    backgroundColor: "rgba(160, 128, 100, .08)"
  },
  "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
    backgroundColor: "rgba(100, 160, 128, .08)"
  },

  ".cm-changedText, .cm-deletedChunk .cm-deletedText": {
    background: "transparent",
  },

  "&light.cm-merge-a .cm-changedText, &light .cm-deletedChunk .cm-deletedText": {
    background: "transparent",
  },

  "&dark.cm-merge-a .cm-changedText, &dark .cm-deletedChunk .cm-deletedText": {
    background: "transparent",
  },

  "&light.cm-merge-b .cm-changedText": {
    background: "transparent",
  },

  "&dark.cm-merge-b .cm-changedText": {
    background: "transparent",
  },

  ".cm-inlineChangeLayer": {
    pointerEvents: "none",
  },

  ".cm-changedTextLayerRanges > svg, .cm-deletedTextLayerRanges > svg": {
    display: "block",
    width: "100%",
    height: "100%",
    overflow: "visible",
  },

  ".cm-inlineChangeLayerPath": {
    fill: "currentColor",
  },

  "&light .cm-deletedChunk .cm-deletedText": {
    background: "transparent",
  },

  "&dark .cm-deletedChunk .cm-deletedText": {
    background: "transparent",
  },

  "&light.cm-merge-a .cm-changedTextLayerRanges": {
    color: "#ee443344",
  },

  "&dark.cm-merge-a .cm-changedTextLayerRanges": {
    color: "#ffaa9944",
  },

  "&light.cm-merge-b .cm-changedTextLayerRanges": {
    color: "#22bb2244",
  },

  "&dark.cm-merge-b .cm-changedTextLayerRanges": {
    color: "#88ff8844",
  },

  "&light .cm-deletedTextLayerRanges": {
    color: "#ee443344",
  },

  "&dark .cm-deletedTextLayerRanges": {
    color: "#ffaa9944",
  },

  ".cm-changedTextEmpty": {
    display: "inline-block",
    position: "relative",
    width: 0,
    height: "1.05em",
    verticalAlign: "-0.12em",
  },

  ".cm-changedTextFullLineEmpty": {
    display: "inline-block",
    width: "1px",
    height: "1lh",
    verticalAlign: "top",
    background: "transparent",
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
    background: "transparent"
  },

  "&.cm-merge-b .cm-deletedTextLayerRanges": {
    color: "#ff000033"
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
