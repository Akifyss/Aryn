export {Change, diff, presentableDiff} from "./diff"
export type {DiffConfig} from "./diff"

export {getChunks, goToNextChunk, goToPreviousChunk} from "./merge"
export type {DeletedContentRenderer, DeletedContentRenderResult} from "./merge"

export {MergeView} from "./mergeview"
export type {MergeConfig, DirectMergeConfig} from "./mergeview"

export {unifiedMergeView, acceptChunk, rejectChunk, getOriginalDoc,
        originalDocChangeEffect, updateOriginalDoc} from "./unified"

export {addChangedLineDecoration, addChunkDecorations, changedText, isLineFullyInsertedOrDeleted, refreshChunkDecorationsEffect, refreshInlineChangeLayerEffect, uncollapseUnchanged, mergeViewSiblings} from "./deco"

export {Chunk} from "./chunk"
