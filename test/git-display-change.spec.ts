import { describe, expect, it } from 'vitest'
import { pickDominantGitDisplayChange } from '@/features/git/lib/display-change'
import type { GitDisplayChange } from '@/features/git/types'

function createChange(
  kind: GitDisplayChange['kind'],
  scope?: Extract<GitDisplayChange, { kind: GitDisplayChange['kind'] }> extends infer T
    ? T extends { scope: infer S } ? S : never
    : never,
): Pick<GitDisplayChange, 'kind'> & Partial<Pick<GitDisplayChange, 'scope'>> {
  return scope ? { kind, scope } : { kind }
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

  it('prefers untracked over deleted and added, matching IDE-style folder summaries', () => {
    expect(
      pickDominantGitDisplayChange([
        createChange('deleted', 'staged'),
        createChange('untracked', 'unstaged'),
        createChange('added', 'staged'),
      ]),
    ).toEqual(createChange('untracked', 'unstaged'))
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

  it('prefers untracked over modified-like and added statuses', () => {
    expect(
      pickDominantGitDisplayChange([
        createChange('untracked'),
        createChange('renamed'),
        createChange('added'),
      ]),
    ).toEqual(createChange('untracked'))
  })

  it('prefers unstaged modifications over staged deletions', () => {
    expect(
      pickDominantGitDisplayChange([
        createChange('deleted', 'staged'),
        createChange('modified', 'unstaged'),
      ]),
    ).toEqual(createChange('modified', 'unstaged'))
  })

  it('returns null when there are no changes', () => {
    expect(pickDominantGitDisplayChange([])).toBeNull()
  })
})
