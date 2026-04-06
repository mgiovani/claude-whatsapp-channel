import { describe, test, expect } from 'bun:test'
import {
  chunk,
  toWhatsAppFormat,
  pickDocumentFilename,
  shouldSendAsDocument,
} from './format.ts'

// ─── chunk ────────────────────────────────────────────────────────────────────

describe('chunk', () => {
  test('returns single-element array when text fits', () => {
    expect(chunk('hello', 100, 'length')).toEqual(['hello'])
  })

  test('splits at exact limit in length mode', () => {
    const text = 'a'.repeat(10)
    const result = chunk(text, 5, 'length')
    expect(result).toEqual(['aaaaa', 'aaaaa'])
  })

  test('splits at paragraph boundary in newline mode', () => {
    const text = 'first para\n\nsecond para that is long enough'
    const result = chunk(text, 15, 'newline')
    expect(result[0]).toBe('first para')
    expect(result[1]).toContain('second para')
  })

  test('splits at space when no newline in newline mode', () => {
    const text = 'hello world foo bar baz'
    const result = chunk(text, 12, 'newline')
    expect(result[0]).toBe('hello world')
    // split position is the space char itself; leading space is preserved in continuation
    expect(result[1].trim()).toBe('foo bar baz')
  })

  test('hard-cuts when no whitespace in newline mode', () => {
    const text = 'a'.repeat(20)
    const result = chunk(text, 10, 'newline')
    expect(result[0]).toHaveLength(10)
  })

  test('strips leading newlines from continuation chunks', () => {
    const text = 'aaaa\nbbbb'
    const result = chunk(text, 5, 'newline')
    expect(result[1]).toBe('bbbb') // no leading \n
  })
})

// ─── toWhatsAppFormat ─────────────────────────────────────────────────────────

describe('toWhatsAppFormat', () => {
  // edge cases
  test('returns empty string unchanged', () => {
    expect(toWhatsAppFormat('')).toBe('')
  })

  test('returns plain text unchanged', () => {
    expect(toWhatsAppFormat('Hello world')).toBe('Hello world')
  })

  // bold
  test('converts **bold** to *bold*', () => {
    expect(toWhatsAppFormat('**bold**')).toBe('*bold*')
  })

  test('converts __bold__ to *bold*', () => {
    expect(toWhatsAppFormat('__bold__')).toBe('*bold*')
  })

  test('converts bold mid-sentence', () => {
    expect(toWhatsAppFormat('Hello **world** foo')).toBe('Hello *world* foo')
  })

  // italic
  test('converts *italic* to _italic_', () => {
    expect(toWhatsAppFormat('*italic*')).toBe('_italic_')
  })

  test('leaves _italic_ unchanged (same in both syntaxes)', () => {
    expect(toWhatsAppFormat('_italic_')).toBe('_italic_')
  })

  test('converts *italic* but not **bold**', () => {
    expect(toWhatsAppFormat('**bold** and *italic*')).toBe('*bold* and _italic_')
  })

  // nested
  test('handles nested **_bold italic_**', () => {
    expect(toWhatsAppFormat('**_bold italic_**')).toBe('*_bold italic_*')
  })

  // strikethrough
  test('converts ~~strike~~ to ~strike~', () => {
    expect(toWhatsAppFormat('~~strikethrough~~')).toBe('~strikethrough~')
  })

  // headers
  test('converts h1 to bold', () => {
    expect(toWhatsAppFormat('# Heading')).toBe('*Heading*')
  })

  test('converts h2 to bold', () => {
    expect(toWhatsAppFormat('## Section')).toBe('*Section*')
  })

  test('converts h6 to bold', () => {
    expect(toWhatsAppFormat('###### Deep')).toBe('*Deep*')
  })

  test('does not convert non-header hash', () => {
    expect(toWhatsAppFormat('#hashtag')).toBe('#hashtag')
  })

  // links
  test('converts [text](url) to text (url)', () => {
    expect(toWhatsAppFormat('[click here](https://example.com)')).toBe('click here (https://example.com)')
  })

  test('converts image ![alt](url) to alt (url)', () => {
    expect(toWhatsAppFormat('![logo](https://example.com/img.png)')).toBe('logo (https://example.com/img.png)')
  })

  test('uses bare url when link label is empty', () => {
    expect(toWhatsAppFormat('[](https://example.com)')).toBe('https://example.com')
  })

  // code blocks
  test('preserves code block content without conversion', () => {
    const input = '```\n**not bold**\n```'
    const result = toWhatsAppFormat(input)
    expect(result).toBe('```\n**not bold**\n```')
  })

  test('strips language hint from fenced code block', () => {
    const input = '```typescript\nconst x = 1\n```'
    const result = toWhatsAppFormat(input)
    expect(result).toBe('```\nconst x = 1\n```')
  })

  test('preserves inline code without conversion', () => {
    expect(toWhatsAppFormat('use `**raw**` here')).toBe('use `**raw**` here')
  })

  // horizontal rules
  test('removes --- horizontal rule', () => {
    expect(toWhatsAppFormat('---')).toBe('')
  })

  test('removes *** horizontal rule', () => {
    expect(toWhatsAppFormat('***')).toBe('')
  })

  test('removes ___ horizontal rule', () => {
    expect(toWhatsAppFormat('___')).toBe('')
  })

  // realistic mixed content
  test('converts a realistic Claude response', () => {
    const input = [
      '## Summary',
      '',
      'Here is **bold text** and *italic text*.',
      '',
      'Use `inline code` and [the docs](https://docs.example.com).',
      '',
      '```python',
      'print("hello")',
      '```',
      '',
      '---',
      '',
      '~~deprecated~~',
    ].join('\n')

    const expected = [
      '*Summary*',
      '',
      'Here is *bold text* and _italic text_.',
      '',
      'Use `inline code` and the docs (https://docs.example.com).',
      '',
      '```\nprint("hello")\n```',
      '',
      '',
      '',
      '~deprecated~',
    ].join('\n')

    expect(toWhatsAppFormat(input)).toBe(expected)
  })
})

// ─── pickDocumentFilename ─────────────────────────────────────────────────────

describe('pickDocumentFilename', () => {
  test('returns txt for plain text (auto)', () => {
    expect(pickDocumentFilename('Hello world', 'auto')).toEqual({ name: 'response.txt', mime: 'text/plain' })
  })

  test('returns md for text with a heading (auto)', () => {
    expect(pickDocumentFilename('# Title\nSome content', 'auto')).toEqual({ name: 'response.md', mime: 'text/markdown' })
  })

  test('returns md for text with bold (auto)', () => {
    expect(pickDocumentFilename('Here is **bold** text', 'auto')).toEqual({ name: 'response.md', mime: 'text/markdown' })
  })

  test('returns md for text with code block (auto)', () => {
    expect(pickDocumentFilename('```\ncode\n```', 'auto')).toEqual({ name: 'response.md', mime: 'text/markdown' })
  })

  test('returns md for text with list (auto)', () => {
    expect(pickDocumentFilename('- item one\n- item two', 'auto')).toEqual({ name: 'response.md', mime: 'text/markdown' })
  })

  test('returns md for text with ordered list (auto)', () => {
    expect(pickDocumentFilename('1. first\n2. second', 'auto')).toEqual({ name: 'response.md', mime: 'text/markdown' })
  })

  test('forces txt when format is txt', () => {
    expect(pickDocumentFilename('# heading', 'txt')).toEqual({ name: 'response.txt', mime: 'text/plain' })
  })

  test('forces md when format is md', () => {
    expect(pickDocumentFilename('plain text', 'md')).toEqual({ name: 'response.md', mime: 'text/markdown' })
  })

  test('defaults to auto when format is omitted', () => {
    expect(pickDocumentFilename('# heading')).toEqual({ name: 'response.md', mime: 'text/markdown' })
  })
})

// ─── shouldSendAsDocument ─────────────────────────────────────────────────────

describe('shouldSendAsDocument', () => {
  test('returns false when threshold is 0 (disabled)', () => {
    expect(shouldSendAsDocument('x'.repeat(10000), 0)).toBe(false)
  })

  test('uses DEFAULT_DOCUMENT_THRESHOLD (4000) when threshold is undefined', () => {
    expect(shouldSendAsDocument('x'.repeat(4001), undefined)).toBe(true)
    expect(shouldSendAsDocument('x'.repeat(100), undefined)).toBe(false)
  })

  test('returns true when threshold is -1 (always)', () => {
    expect(shouldSendAsDocument('short', -1)).toBe(true)
  })

  test('returns false when text is shorter than threshold', () => {
    expect(shouldSendAsDocument('x'.repeat(100), 4000)).toBe(false)
  })

  test('returns false when text length equals threshold', () => {
    expect(shouldSendAsDocument('x'.repeat(4000), 4000)).toBe(false)
  })

  test('returns true when text length exceeds threshold', () => {
    expect(shouldSendAsDocument('x'.repeat(4001), 4000)).toBe(true)
  })
})
