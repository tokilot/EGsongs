import { describe, expect, it } from 'vitest'
import { compareNames, initialOf, sortByName } from './alphabetical.ts'

describe('sorting by first letter', () => {
  it('gives Chinese names the pinyin initial of their first character', () => {
    const cases: Array<[string, string]> = [
      ['阿甘', 'A'],
      ['贝斯', 'B'],
      ['春天', 'C'],
      ['低音', 'D'],
      ['二胡', 'E'],
      ['风琴', 'F'],
      ['鼓', 'G'],
      ['钢琴', 'G'],
      ['和声', 'H'],
      ['吉他', 'J'],
      ['节奏吉他', 'J'],
      ['口琴', 'K'],
      ['樊城之战', 'F'],
      ['铃鼓', 'L'],
      ['木吉他', 'M'],
      ['女声', 'N'],
      ['欧', 'O'],
      ['琵琶', 'P'],
      ['七里香', 'Q'],
      ['人声', 'R'],
      ['失真', 'S'],
      // Not a character read two ways (弹 is tán or dàn).
      ['天空', 'T'],
      ['晚风', 'W'],
      ['小提琴', 'X'],
      ['音色', 'Y'],
      ['主音吉他', 'Z'],
    ]
    expect(cases.map(([name]) => [name, initialOf(name)])).toEqual(cases)
  })

  it('takes Latin initials as they are, and puts the rest under #', () => {
    expect(['guitar', ' Bass', 'Ünder', '2nd Guitar', '', '(intro)'].map(initialOf)).toEqual(['G', 'B', '#', '#', '#', '#'])
  })

  it('mixes Chinese and Latin names by letter, numbers first, then the whole name', () => {
    const names = ['Lead Guitar', '吉他', 'Drums', '贝斯', 'bass', '2nd Guitar', 'Guitar', '鼓', 'Keys', 'Track 10', 'Track 2']
    expect(sortByName(names, (name) => name)).toEqual(['2nd Guitar', 'bass', '贝斯', 'Drums', 'Guitar', '鼓', '吉他', 'Keys', 'Lead Guitar', 'Track 2', 'Track 10'])
  })

  it('keeps the order of equal names', () => {
    const items = [{ name: 'Guitar', id: 1 }, { name: 'Bass', id: 2 }, { name: 'guitar', id: 3 }]
    expect(sortByName(items, (item) => item.name).map((item) => item.id)).toEqual([2, 1, 3])
    expect(compareNames('a', 'A')).toBe(0)
  })
})
