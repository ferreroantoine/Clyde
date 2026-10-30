import { describe, expect, it } from 'vitest'
import { compareCells, guessDelimiter, parseDelimited } from './delimited'

describe('parseDelimited', () => {
  it('reads a header and rows, quotes included', () => {
    const table = parseDelimited('name,note\r\n"Doe, Jane","said ""hi""\nthen left"\nBob,\n', ',')
    expect(table.header).toEqual(['name', 'note'])
    expect(table.rows).toEqual([
      ['Doe, Jane', 'said "hi"\nthen left'],
      ['Bob', '']
    ])
    expect(table.truncated).toBe(false)
  })

  it('reads TSV, skips blank lines and a BOM', () => {
    const table = parseDelimited('﻿a\tb\n\n1\t2\n3\t4', '\t')
    expect(table.header).toEqual(['a', 'b'])
    expect(table.rows).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('keeps the first rows past the limit and says so', () => {
    const text = ['h', ...Array.from({ length: 10 }, (_, i) => String(i))].join('\n')
    const table = parseDelimited(text, ',', 3)
    expect(table.rows).toEqual([['0'], ['1'], ['2']])
    expect(table.truncated).toBe(true)
    expect(parseDelimited('h\n0\n1\n2\n', ',', 3).truncated).toBe(false)
  })

  it('pads the header to the widest row', () => {
    expect(parseDelimited('a\n1,2,3', ',').header).toEqual(['a', '', ''])
  })
})

describe('guessDelimiter', () => {
  it('follows the extension, then the first line', () => {
    expect(guessDelimiter('a,b', 'tsv')).toBe('\t')
    expect(guessDelimiter('a;b;c\n1,5;2;3', 'csv')).toBe(';')
    expect(guessDelimiter('a,b\n1;2', 'csv')).toBe(',')
  })
})

describe('compareCells', () => {
  const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' })
  it('sorts numbers as numbers, before text', () => {
    const cells = ['10', 'b', '9', '1,5', 'A', '']
    expect([...cells].sort((a, b) => compareCells(a, b, collator))).toEqual(['1,5', '9', '10', '', 'A', 'b'])
  })
})
