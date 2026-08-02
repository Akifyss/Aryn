import { describe, expect, it } from 'vitest'
import {
  buildInteractionFieldAnswers,
  updateInteractionFieldSelection,
} from '@/features/agent/components/agent-interaction-panel/agent-interaction-panel'

describe('agent interaction field state', () => {
  it('replaces a single-select choice and toggles multi-select choices', () => {
    const single = updateInteractionFieldSelection({}, 'single', 'alpha', false)
    expect(updateInteractionFieldSelection(single, 'single', 'beta', false))
      .toEqual({ single: ['beta'] })

    const first = updateInteractionFieldSelection({}, 'multi', 'alpha', true)
    const second = updateInteractionFieldSelection(first, 'multi', 'beta', true)
    expect(second).toEqual({ multi: ['alpha', 'beta'] })
    expect(updateInteractionFieldSelection(second, 'multi', 'alpha', true))
      .toEqual({ multi: ['beta'] })
  })

  it('submits selected options and a custom answer without losing either', () => {
    const answers = buildInteractionFieldAnswers([{
      allowsCustomAnswer: true,
      id: 'targets',
      label: 'Targets',
      multiSelect: true,
      options: [
        { id: 'web', label: 'Web' },
        { id: 'desktop', label: 'Desktop' },
      ],
    }, {
      id: 'secret',
      isSecret: true,
      label: 'Secret',
    }], {
      targets: ['web', 'desktop'],
    }, {
      targets: 'mobile',
      secret: 'token',
    })

    expect(answers).toEqual({
      targets: ['web', 'desktop', 'mobile'],
      secret: ['token'],
    })
  })
})
