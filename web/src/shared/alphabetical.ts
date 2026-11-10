// Sorting names "by their first letter" (2026-11-10: the track lists and "My tabs"): a Chinese name goes by the pinyin
// initial of its first character, among the Latin names with that letter (吉他 with the J's, not after the Z's);
// names starting with anything else (digits, signs) come first. Within one letter the Latin names come first, then
// the whole names decide.

const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/**
 * For each initial, the first Han character in pinyin order that has it: a character sorting at or after one of
 * these (and before the next) starts with its letter. There are no Han syllables starting with I, U or V. Written as
 * escapes, the character in the comment: they are sort keys, not text on the page (see ui/i18n.test.ts).
 */
const HAN_INITIALS: Array<[string, string]> = [
  ['A', '\u963F'], // 阿
  ['B', '\u516B'], // 八
  ['C', '\u5693'], // 嚓
  ['D', '\u54D2'], // 哒
  ['E', '\u59B8'], // 妸
  ['F', '\u53D1'], // 发
  ['G', '\u65EE'], // 旮
  ['H', '\u54C8'], // 哈
  ['J', '\u8BA5'], // 讥
  ['K', '\u5494'], // 咔
  ['L', '\u5783'], // 垃
  ['M', '\u5988'], // 妈
  ['N', '\u62CF'], // 拏
  ['O', '\u5662'], // 噢
  ['P', '\u5991'], // 妑
  ['Q', '\u4E03'], // 七
  ['R', '\u5465'], // 呥
  ['S', '\u6268'], // 扨
  ['T', '\u5B83'], // 它
  ['W', '\u7A75'], // 穵
  ['X', '\u5915'], // 夕
  ['Y', '\u4E2B'], // 丫
  ['Z', '\u5E00'], // 帀
]

const HAN = /\p{Script=Han}/u

/** The letter a name is sorted under: A–Z, or '#' for anything that does not start with a letter or a Han character. */
export function initialOf(name: string): string {
  const first = [...name.trim()][0] ?? ''
  if (/^[a-z]$/i.test(first)) return first.toUpperCase()
  if (!HAN.test(first)) return '#'
  let letter = '#'
  for (const [initial, bound] of HAN_INITIALS) {
    if (collator.compare(first, bound) < 0) break
    letter = initial
  }
  return letter
}

/** Orders two names by their first letter, then by the whole name. */
export function compareNames(a: string, b: string): number {
  const first = initialOf(a)
  const second = initialOf(b)
  if (first !== second) return first === '#' ? -1 : second === '#' ? 1 : first < second ? -1 : 1
  // Under one letter the Latin names come before the Chinese ones.
  const han = (name: string) => (HAN.test([...name.trim()][0] ?? '') ? 1 : 0)
  return han(a) - han(b) || collator.compare(a.trim(), b.trim())
}

/** A sorted copy, by the name `nameOf` gives each item; items with the same name keep their order. */
export function sortByName<T>(items: readonly T[], nameOf: (item: T) => string): T[] {
  return items
    .map((item, index) => ({ item, index, name: nameOf(item) }))
    .sort((a, b) => compareNames(a.name, b.name) || a.index - b.index)
    .map(({ item }) => item)
}
