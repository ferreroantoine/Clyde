import { fr } from './fr'

/**
 * Interface strings. The English text is the key: `t('Add account')`. Other languages map
 * it in their dictionary; a missing entry falls back to English. Values go in `{name}` slots
 * so a sentence stays one key: `t('{count} agents running', { count })`.
 * A test checks that every key used in the code has a French entry.
 */
export type Locale = 'en' | 'fr'
export type Language = Locale | 'system'

const DICTIONARIES: Record<Exclude<Locale, 'en'>, Record<string, string>> = { fr }

let current: Locale = 'en'
const listeners = new Set<(locale: Locale) => void>()

/** `system` follows the OS language: French when it is French, English otherwise. */
export function resolveLocale(language: Language, systemLocale: string): Locale {
  if (language !== 'system') return language
  return systemLocale.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  for (const l of listeners) l(locale)
}

export function getLocale(): Locale {
  return current
}

export function onLocaleChange(listener: (locale: Locale) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

type Params = Record<string, string | number | null | undefined>

function fill(text: string, params?: Params): string {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}

/** Translates an interface string. */
export function t(text: string, params?: Params): string {
  const translated = current === 'en' ? text : (DICTIONARIES[current][text] ?? text)
  return fill(translated, params)
}

/** Singular or plural by count, with the language's rule (French: 0 and 1 are singular). */
export function tn(one: string, other: string, count: number, params?: Params): string {
  const singular = current === 'fr' ? Math.abs(count) < 2 : count === 1
  return t(singular ? one : other, { count, ...params })
}

/**
 * Marks a string defined outside rendering (a label in a table) as an interface string. It
 * returns it unchanged; translate it with t() where it is shown. The i18n test collects both.
 */
export function tk<T extends string>(text: T): T {
  return text
}

/** Dates and numbers in the interface language. */
export function intlLocale(): string {
  return current === 'fr' ? 'fr-FR' : 'en-US'
}
