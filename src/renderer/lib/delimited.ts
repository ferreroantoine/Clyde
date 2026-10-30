/** CSV and TSV, RFC 4180 style: quoted fields may hold the delimiter, quotes ("") and new lines. */
export interface Table {
  header: string[]
  rows: string[][]
  /** More rows than `maxRows` were in the text: only the first ones are kept. */
  truncated: boolean
  delimiter: string
}

/** Tab for .tsv; for .csv a comma, unless the first line has more semicolons (European exports). */
export function guessDelimiter(text: string, extension: string): string {
  if (extension === 'tsv') return '\t'
  const first = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n'))
  const count = (c: string) => first.split(c).length - 1
  return count(';') > count(',') ? ';' : count('\t') > count(',') ? '\t' : ','
}

export function parseDelimited(text: string, delimiter: string, maxRows = 100_000): Table {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let truncated = false
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const endRow = () => {
    row.push(field)
    field = ''
    // A blank line is not a row.
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
  }
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i++
      endRow()
      // One row for the header, then `maxRows` of data.
      if (rows.length > maxRows) {
        truncated = i < source.length - 1
        break
      }
    } else field += c
  }
  if (!truncated && (field !== '' || row.length > 0)) endRow()
  const [header = [], ...data] = rows
  const width = Math.max(header.length, ...data.slice(0, 1000).map((r) => r.length))
  const names = Array.from({ length: width }, (_, i) => header[i] ?? '')
  return { header: names, rows: data, truncated, delimiter }
}

/** Compares two cells: numbers as numbers, then text in the user's collation. */
export function compareCells(a: string, b: string, collator: Intl.Collator): number {
  const na = toNumber(a)
  const nb = toNumber(b)
  if (na !== null && nb !== null) return na - nb
  if (na !== null) return -1
  if (nb !== null) return 1
  return collator.compare(a, b)
}

function toNumber(v: string): number | null {
  const s = v.trim()
  if (!s || !/^[-+]?(\d[\d\s]*)?([.,]\d+)?(e[-+]?\d+)?$/i.test(s)) return null
  const n = Number(s.replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
