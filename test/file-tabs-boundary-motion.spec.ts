import { describe, expect, it } from 'vitest'
import {
  easeFileTabActivation,
  interpolateFileTabActiveGeometry,
  parseCssTimeInMilliseconds,
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
