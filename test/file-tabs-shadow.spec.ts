import { describe, expect, it } from 'vitest'
import {
  getFileTabsShadowFilterPadding,
  parseComputedBoxShadow,
} from '../src/features/workspace/components/file-tabs/file-tabs-shadow'

describe('file tab shadow token adapter', () => {
  it('parses the computed stacked shadow token without flattening its layers', () => {
    const layers = parseComputedBoxShadow(
      'rgba(0, 0, 0, 0.03) 0px 18px 47px 0px, rgba(0, 0, 0, 0.02) 0px 7.5px 19px 0px',
    )

    expect(layers).toEqual([
      {
        blurRadius: 47,
        color: 'rgba(0, 0, 0, 0.03)',
        offsetX: 0,
        offsetY: 18,
        spreadRadius: 0,
      },
      {
        blurRadius: 19,
        color: 'rgba(0, 0, 0, 0.02)',
        offsetX: 0,
        offsetY: 7.5,
        spreadRadius: 0,
      },
    ])
  })

  it('supports spread radii and ignores inset shadows that cannot become an outer SVG shadow', () => {
    expect(parseComputedBoxShadow('rgb(0, 0, 0) 2px 3px 8px -2px')).toEqual([
      {
        blurRadius: 8,
        color: 'rgb(0, 0, 0)',
        offsetX: 2,
        offsetY: 3,
        spreadRadius: -2,
      },
    ])
    expect(parseComputedBoxShadow('inset 0 0 2px rgb(0, 0, 0)')).toEqual([])
    expect(parseComputedBoxShadow('none')).toEqual([])
  })

  it('sizes the SVG filter region for the widest token layer', () => {
    expect(getFileTabsShadowFilterPadding([
      {
        blurRadius: 47,
        color: 'rgba(0, 0, 0, 0.03)',
        offsetX: 0,
        offsetY: 18,
        spreadRadius: 0,
      },
      {
        blurRadius: 19,
        color: 'rgba(0, 0, 0, 0.02)',
        offsetX: 0,
        offsetY: 7.5,
        spreadRadius: 0,
      },
    ])).toEqual({ x: 71, y: 89 })
  })
})
