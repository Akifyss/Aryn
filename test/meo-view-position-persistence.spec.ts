import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMeoViewPositionPersistenceController } from '../src/features/editor/lib/meo-native-editor-persistence'
import { initializeMeoStoredStates, readStoredState } from '../src/features/editor/lib/meo-state'
import type { MeoEditorMode, MeoEditorViewportPosition } from '../src/features/editor/lib/meo-native-editor-types'

class MemoryStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

let previousWindowDescriptor: PropertyDescriptor | undefined
let currentMode: MeoEditorMode

beforeEach(() => {
  currentMode = 'live'
  previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      appApi: {
        updateMeoFileState: () => Promise.resolve({ ok: true }),
      },
      clearTimeout,
      localStorage: new MemoryStorage(),
      setTimeout,
    },
  })
  initializeMeoStoredStates({})
})

afterEach(() => {
  if (previousWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', previousWindowDescriptor)
  } else {
    delete (globalThis as { window?: unknown }).window
  }
})

describe('meo view position persistence', () => {
  const createController = (
    filePath: string,
    getEditorPosition: () => MeoEditorViewportPosition | null,
  ) => createMeoViewPositionPersistenceController({
    filePath,
    getEditorPosition,
    getMode: () => currentMode,
  })

  it('captures and restores top-line positions for short documents', () => {
    const filePath = 'C:/workspace/short.md'
    const { controller } = createController(
      filePath,
      () => ({ line: 3, lineOffset: 12 }),
    )

    controller.captureViewPosition()

    expect(readStoredState(filePath)).toMatchObject({
      topLine: 3,
      topLineOffset: 12,
      viewPositions: {
        live: {
          topLine: 3,
          topLineOffset: 12,
        },
      },
    })

    const restored = createController(
      filePath,
      () => null,
    ).controller

    expect(restored.getInitialRestoreTopLine('live')).toBe(3)
    expect(restored.getInitialRestoreTopLineOffset('live')).toBe(12)
  })

  it('does not overwrite a stored position with the initial default top during remount', () => {
    const filePath = 'C:/workspace/remount.md'
    createController(
      filePath,
      () => null,
    ).controller.persistViewPositionFromMessage({ topLine: 42, topLineOffset: 6 })

    createController(
      filePath,
      () => ({ line: 1, lineOffset: 0 }),
    ).controller.captureViewPosition()

    expect(readStoredState(filePath)).toMatchObject({
      topLine: 42,
      topLineOffset: 6,
      viewPositions: {
        live: {
          topLine: 42,
          topLineOffset: 6,
        },
      },
    })
  })

  it('does not overwrite a stored position from an unmeasured initial viewport', () => {
    const filePath = 'C:/workspace/zero-viewport.md'
    createController(
      filePath,
      () => null,
    ).controller.persistViewPositionFromMessage({ topLine: 66, topLineOffset: 2.5 })

    createController(
      filePath,
      () => ({
        clientHeight: 0,
        line: 1,
        lineOffset: 0,
        scrollHeight: 0,
        scrollTop: 0,
      }),
    ).controller.captureViewPosition()

    expect(readStoredState(filePath)).toMatchObject({
      topLine: 66,
      topLineOffset: 2.5,
      viewPositions: {
        live: {
          topLine: 66,
          topLineOffset: 2.5,
        },
      },
    })
  })

  it('allows a deliberate top position after a real non-default position was observed', () => {
    const filePath = 'C:/workspace/user-top.md'
    let editorPosition: MeoEditorViewportPosition = {
      clientHeight: 818,
      line: 66,
      lineOffset: 2.5,
      scrollHeight: 3048,
      scrollTop: 1200,
    }
    const { controller } = createController(
      filePath,
      () => editorPosition,
    )

    controller.captureViewPosition()
    editorPosition = {
      clientHeight: 818,
      line: 1,
      lineOffset: 0,
      scrollHeight: 3048,
      scrollTop: 0,
    }
    controller.captureViewPosition()

    expect(readStoredState(filePath)).toMatchObject({
      topLine: 1,
      topLineOffset: 0,
      viewPositions: {
        live: {
          topLine: 1,
          topLineOffset: 0,
        },
      },
    })
  })

  it('keeps independent scroll positions for every meo mode in the same file', () => {
    const filePath = 'C:/workspace/modes.md'
    const modes: MeoEditorMode[] = ['live', 'source', 'diff-split', 'diff-unified']
    const positions: Record<MeoEditorMode, MeoEditorViewportPosition> = {
      'diff-split': { line: 31, lineOffset: 4.5 },
      'diff-unified': { line: 41, lineOffset: 5.5 },
      live: { line: 11, lineOffset: 2.5 },
      source: { line: 21, lineOffset: 3.5 },
    }
    const { controller } = createController(
      filePath,
      () => positions[currentMode],
    )

    modes.forEach((mode) => {
      currentMode = mode
      controller.captureViewPosition()
      controller.persistMode(mode)
    })

    const storedState = readStoredState(filePath)
    expect(storedState.viewPositions).toMatchObject({
      'diff-split': {
        topLine: 31,
        topLineOffset: 4.5,
      },
      'diff-unified': {
        topLine: 41,
        topLineOffset: 5.5,
      },
      live: {
        topLine: 11,
        topLineOffset: 2.5,
      },
      source: {
        topLine: 21,
        topLineOffset: 3.5,
      },
    })

    const restored = createController(
      filePath,
      () => null,
    ).controller

    modes.forEach((mode) => {
      expect(restored.getInitialRestoreTopLine(mode)).toBe(positions[mode].line)
      expect(restored.getInitialRestoreTopLineOffset(mode)).toBe(positions[mode].lineOffset)
    })
  })

  it('migrates the legacy top-line position only into the stored initial mode', () => {
    const filePath = 'C:/workspace/legacy.md'
    initializeMeoStoredStates({
      [filePath]: {
        mode: 'source',
        topLine: 42,
        topLineOffset: 6,
      },
    })

    currentMode = 'source'
    const restored = createController(
      filePath,
      () => null,
    ).controller

    expect(restored.getInitialMode()).toBe('source')
    expect(restored.getInitialRestoreTopLine('source')).toBe(42)
    expect(restored.getInitialRestoreTopLineOffset('source')).toBe(6)
    expect(restored.getInitialRestoreTopLine('live')).toBeUndefined()
  })
})
