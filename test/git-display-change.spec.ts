import { describe, expect, it } from 'vitest'
import { pickDominantGitDisplayChange } from '@/features/git/lib/display-change'
import type { GitDisplayChange } from '@/features/git/types'

function createChange(kind: GitDisplayChange['kind']): Pick<GitDisplayChange, 'kind'> {
  return { kind }
}

describe('pickDominantGitDisplayChange', () => {
  it('prefers deleted over added for directory-style mixed changes', () => {
    expect(
      pickDominantGitDisplayChange([
        createChange('added'),
        createChange('deleted'),
      ]),
    ).toEqual(createChange('deleted'))
  })

  it('prefers conflicted over every other change kind', () => {
    expect(
      pickDominantGitDisplayChange([
        createChange('modified'),
        createChange('conflicted'),
        createChange('deleted'),
      ]),
    ).toEqual(createChange('conflicted'))
  })

  it('treats modified-like statuses as stronger than added and untracked', () => {
    expect(
      pickDominantGitDisplayChange([
        createChange('untracked'),
        createChange('renamed'),
        createChange('added'),
      ]),
    ).toEqual(createChange('renamed'))
  })

  it('returns null when there are no changes', () => {
    expect(pickDominantGitDisplayChange([])).toBeNull()
  })
})
