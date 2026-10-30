import { describe, expect, it } from 'vitest'
import { extensionOf, fileUrl, formatBytes, hasTextPreview, isBinaryViewer, resolveRelative, viewerFor } from './viewers'

describe('viewerFor', () => {
  it('picks a viewer by extension, whatever the case', () => {
    expect(viewerFor('docs/README.md')).toBe('markdown')
    expect(viewerFor('a/Photo.JPEG')).toBe('image')
    expect(viewerFor('logo.svg')).toBe('svg')
    expect(viewerFor('report.pdf')).toBe('pdf')
    expect(viewerFor('song.flac')).toBe('audio')
    expect(viewerFor('clip.mkv')).toBe('video')
    expect(viewerFor('data.tsv')).toBe('table')
    expect(viewerFor('events.jsonl')).toBe('json')
    expect(viewerFor('letter.docx')).toBe('docx')
    expect(viewerFor('budget.ods')).toBe('sheet')
  })

  it('falls back to the code editor', () => {
    expect(viewerFor('src/main.ts')).toBe('text')
    expect(viewerFor('.env')).toBe('text')
    expect(viewerFor('Makefile')).toBe('text')
    expect(extensionOf('archive.tar.gz')).toBe('gz')
  })

  it('tells text previews from byte viewers', () => {
    expect(hasTextPreview('markdown')).toBe(true)
    expect(isBinaryViewer('markdown')).toBe(false)
    expect(isBinaryViewer('pdf')).toBe(true)
    expect(hasTextPreview('text') || isBinaryViewer('text')).toBe(false)
  })
})

describe('fileUrl', () => {
  it('encodes each part and adds the version', () => {
    expect(fileUrl('img dir/é #1.png', 12.7)).toBe('clyde-file://workspace/img%20dir/%C3%A9%20%231.png?v=13')
  })
})

describe('resolveRelative', () => {
  it('resolves against the Markdown file folder', () => {
    expect(resolveRelative('docs/guide/intro.md', './img/a.png')).toBe('docs/guide/img/a.png')
    expect(resolveRelative('docs/guide/intro.md', '../README.md#install')).toBe('docs/README.md')
    expect(resolveRelative('docs/intro.md', '/src/main.ts')).toBe('src/main.ts')
    expect(resolveRelative('docs/intro.md', 'my%20file.md')).toBe('docs/my file.md')
  })

  it('leaves URLs, anchors and escapes alone', () => {
    expect(resolveRelative('a.md', 'https://example.com/x.png')).toBeNull()
    expect(resolveRelative('a.md', 'data:image/png;base64,AAA')).toBeNull()
    expect(resolveRelative('a.md', '#section')).toBeNull()
    expect(resolveRelative('a.md', '../../etc/passwd')).toBeNull()
  })
})

describe('formatBytes', () => {
  it('rounds to a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB')
  })
})
