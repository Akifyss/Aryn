import { describe, expect, it, vi } from 'vitest'
import {
  canRetargetFileTabActiveMotion,
  easeFileTabActivation,
  interpolateFileTabActiveGeometry,
  parseCssTimeInMilliseconds,
  renderFileTabBoundaryMotionFrame,
  resolveFileTabAnimationFrame,
  resolveFileTabAutoScrollBehavior,
  resolveFileTabShadowSnapshotTransform,
} from '../src/features/workspace/components/file-tabs/file-tabs-boundary-motion'

describe('file tab boundary motion', () => {
  it('uses a clamped deceleration curve', () => {
    expect(easeFileTabActivation(-1)).toBe(0)
    expect(easeFileTabActivation(0)).toBe(0)
    expect(easeFileTabActivation(0.5)).toBe(0.875)
    expect(easeFileTabActivation(1)).toBe(1)
    expect(easeFileTabActivation(2)).toBe(1)
  })

  it('interpolates every active-tab geometry field through the same eased progress', () => {
    const from = {
      activeHeight: 38,
      activeLeft: 0,
      activeTop: 6,
      activeWidth: 100,
    }
    const to = {
      activeHeight: 38,
      activeLeft: 120,
      activeTop: 6,
      activeWidth: 140,
    }

    expect(interpolateFileTabActiveGeometry(from, to, 0)).toEqual(from)
    expect(interpolateFileTabActiveGeometry(from, to, 0.5)).toEqual({
      activeHeight: 38,
      activeLeft: 105,
      activeTop: 6,
      activeWidth: 135,
    })
    expect(interpolateFileTabActiveGeometry(from, to, 1)).toEqual(to)
  })

  it('starts timing on the first renderable frame instead of consuming delayed setup time', () => {
    const firstFrame = resolveFileTabAnimationFrame(5_000, null, 180)

    expect(firstFrame).toEqual({
      progress: 0,
      startedAt: 5_000,
    })
    expect(resolveFileTabAnimationFrame(5_090, firstFrame.startedAt, 180)).toEqual({
      progress: 0.5,
      startedAt: 5_000,
    })
    expect(resolveFileTabAnimationFrame(5_180, firstFrame.startedAt, 180)).toEqual({
      progress: 1,
      startedAt: 5_000,
    })
  })

  it('retargets an in-flight activation when scrolling moves the same tab', () => {
    const currentTarget = {
      activeHeight: 38,
      activeLeft: 420,
      activeTop: 6,
      activeWidth: 160,
      isLayoutChanging: false,
      tabId: 'file://later.md',
    }

    expect(canRetargetFileTabActiveMotion(currentTarget, {
      ...currentTarget,
      activeLeft: 300,
    })).toBe(true)
    expect(canRetargetFileTabActiveMotion(currentTarget, {
      ...currentTarget,
      tabId: 'file://another.md',
    })).toBe(false)
    expect(canRetargetFileTabActiveMotion(currentTarget, {
      ...currentTarget,
      activeLeft: 300,
      isLayoutChanging: true,
    })).toBe(false)
  })

  it('does not smooth-scroll hidden tabs when reduced motion is requested', () => {
    expect(resolveFileTabAutoScrollBehavior(false)).toBe('smooth')
    expect(resolveFileTabAutoScrollBehavior(true)).toBe('auto')
  })

  it('renders each in-flight boundary path in the same animation frame', () => {
    const activeFill = { setAttribute: vi.fn() }
    const outline = { setAttribute: vi.fn() }
    const shadow = { setAttribute: vi.fn() }
    const paths = {
      activeFillPath: 'M active',
      outlinePath: 'M outline',
      surfacePath: 'M surface',
    }

    expect(renderFileTabBoundaryMotionFrame({ activeFill, outline, shadow }, paths)).toBe(true)
    expect(activeFill.setAttribute).toHaveBeenCalledWith('d', paths.activeFillPath)
    expect(outline.setAttribute).toHaveBeenCalledWith('d', paths.outlinePath)
    expect(shadow.setAttribute).toHaveBeenCalledWith('d', paths.surfacePath)
  })

  it('falls back to React when the required boundary paths are not mounted', () => {
    const outline = { setAttribute: vi.fn() }
    const paths = {
      activeFillPath: 'M active',
      outlinePath: 'M outline',
      surfacePath: 'M surface',
    }

    expect(renderFileTabBoundaryMotionFrame({
      activeFill: null,
      outline,
      shadow: null,
    }, paths)).toBe(false)
    expect(outline.setAttribute).not.toHaveBeenCalled()
  })

  it('parses CSS duration tokens without accepting ambiguous unitless values', () => {
    expect(parseCssTimeInMilliseconds('180ms')).toBe(180)
    expect(parseCssTimeInMilliseconds('0.2s')).toBe(200)
    expect(parseCssTimeInMilliseconds('0ms')).toBe(0)
    expect(parseCssTimeInMilliseconds('180', 140)).toBe(140)
    expect(parseCssTimeInMilliseconds('invalid', 140)).toBe(140)
  })

  it('maps a frozen shadow surface onto the live editor frame with compositor geometry', () => {
    expect(resolveFileTabShadowSnapshotTransform(
      {
        frameHeight: 900,
        frameLeft: 320,
        frameTop: 44,
        frameWidth: 1200,
      },
      {
        frameHeight: 900,
        frameLeft: 0,
        frameTop: 44,
        frameWidth: 1520,
      },
    )).toEqual({
      scaleX: 1520 / 1200,
      scaleY: 1,
      translateX: -320,
      translateY: 0,
    })
  })

  it('rejects unmeasurable shadow snapshot geometry', () => {
    expect(resolveFileTabShadowSnapshotTransform(
      {
        frameHeight: 900,
        frameLeft: 320,
        frameTop: 44,
        frameWidth: 0,
      },
      {
        frameHeight: 900,
        frameLeft: 0,
        frameTop: 44,
        frameWidth: 1520,
      },
    )).toBeNull()
  })

})
