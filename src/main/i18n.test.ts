import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fr } from '@shared/i18n/fr'
import { resolveLocale, setLocale, t, tn } from '@shared/i18n'

const ROOT = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name)
    if (statSync(file).isDirectory()) return sources(file)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [file] : []
  })
}

/** Every literal passed to t() or tn(), with where it is used. */
function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  const call = /\btk?\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1|\btn\(\s*(['"])((?:\\.|(?!\3)[^\\])*)\3\s*,\s*(['"])((?:\\.|(?!\5)[^\\])*)\5/g
  // The i18n module's own comments show example keys.
  for (const file of sources(ROOT).filter((f) => !f.includes(join('shared', 'i18n')))) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(call)) {
      const where = relative(ROOT, file)
      for (const raw of [m[2], m[4], m[6]]) {
        if (raw !== undefined) keys.set(raw.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n'), where)
      }
    }
  }
  return keys
}

describe('i18n', () => {
  it('translates with values and falls back to English', () => {
    setLocale('fr')
    try {
      expect(t('A string nobody translated {x}', { x: 1 })).toBe('A string nobody translated 1')
      expect(tn('{count} file', '{count} files', 2)).toBe(fr['{count} files']?.replace('{count}', '2') ?? '2 files')
    } finally {
      setLocale('en')
    }
    expect(t('{a} and {b}', { a: 1 })).toBe('1 and {b}')
  })

  it('follows the system language when asked', () => {
    expect(resolveLocale('system', 'fr-CA')).toBe('fr')
    expect(resolveLocale('system', 'de-DE')).toBe('en')
    expect(resolveLocale('en', 'fr-FR')).toBe('en')
  })

  it('has a French entry for every string the interface uses', () => {
    const missing = [...usedKeys()].filter(([key]) => !(key in fr)).map(([key, where]) => `${where}: ${key}`)
    expect(missing).toEqual([])
  })

  it('keeps the same {placeholders} in French', () => {
    const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')
    const wrong = Object.entries(fr).filter(([en, f]) => names(en) !== names(f)).map(([en]) => en)
    expect(wrong).toEqual([])
  })
})
