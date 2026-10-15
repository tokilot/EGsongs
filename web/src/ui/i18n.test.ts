// Every Chinese string the interface can show must have an English entry in EN.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EN } from './i18n.ts'

const root = path.resolve(import.meta.dirname, '..')
const CJK = /[一-鿿]/

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !['i18n.ts', 'gmPrograms.ts'].includes(entry.name) ? [full] : []
  })
}

function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
}

describe('translations', () => {
  const files = sourceFiles(root)

  it('cover every quoted Chinese string', () => {
    const missing = new Set<string>()
    for (const file of files) {
      const code = withoutComments(readFileSync(file, 'utf8'))
      for (const match of code.matchAll(/'([^'\n]*)'/g)) {
        if (CJK.test(match[1]) && !(match[1] in EN)) missing.add(`${path.relative(root, file)}: ${match[1]}`)
      }
    }
    expect([...missing]).toEqual([])
  })

  it('leave no untranslated Chinese text in JSX', () => {
    const raw: string[] = []
    for (const file of files.filter((name) => name.endsWith('.tsx'))) {
      const code = withoutComments(readFileSync(file, 'utf8'))
      for (const match of code.matchAll(/>([^<>{}]*)</g)) {
        if (CJK.test(match[1])) raw.push(`${path.relative(root, file)}: ${match[1].trim()}`)
      }
    }
    expect(raw).toEqual([])
  })

  it('have placeholders that match', () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
    for (const [zh, en] of Object.entries(EN)) expect(names(en), zh).toEqual(names(zh))
  })
})
