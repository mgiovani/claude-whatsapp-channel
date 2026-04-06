/**
 * Text formatting: message chunking and Markdown-to-WhatsApp conversion.
 * Pure functions, no side effects.
 */

import { DEFAULT_DOCUMENT_THRESHOLD } from './constants.ts'

// ─── Message chunking ─────────────────────────────────────────────────────────

export function chunk(text: string, limit: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= limit) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = limit
    if (mode === 'newline') {
      const para = rest.lastIndexOf('\n\n', limit)
      const line = rest.lastIndexOf('\n', limit)
      const space = rest.lastIndexOf(' ', limit)
      cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit
    }
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(/^\n+/, '')
  }
  if (rest) out.push(rest)
  return out
}

// ─── Markdown => WhatsApp formatting ──────────────────────────────────────────

/**
 * Converts a Markdown-formatted string to WhatsApp-native rich text syntax.
 * Applied per-chunk in the reply handler, after chunk() splits the text.
 *
 * Conversion table:
 *   **bold** / __bold__  =>  *bold*
 *   *italic* / _italic_  =>  _italic_  (no change for _italic_, converts *italic*)
 *   ~~strike~~           =>  ~strike~
 *   # Heading (any level)=>  *Heading*
 *   [text](url)          =>  text (url)
 *   ![alt](url)          =>  alt (url)
 *   ```lang\ncode```     =>  ```\ncode```  (language hint stripped)
 *   --- / *** / ___ (HR)  =>  (removed)
 */
export function toWhatsAppFormat(text: string): string {
  if (!text) return text

  // Protect fenced code blocks from inline transformations.
  // Language hints (```ts, ```python, etc.) are stripped — WhatsApp ignores them.
  const codeBlocks: string[] = []
  text = text.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_match, _lang, content: string) => {
    codeBlocks.push('```\n' + content + '```')
    return `\x00CB${codeBlocks.length - 1}\x00`
  })

  // Protect inline code from inline transformations.
  const inlineCodes: string[] = []
  text = text.replace(/`([^`\n]+)`/g, (_match, content: string) => {
    inlineCodes.push('`' + content + '`')
    return `\x00IC${inlineCodes.length - 1}\x00`
  })

  // Headers: # Heading => *Heading* (use placeholder to avoid italic step consuming it)
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '\x01$1\x01')

  // Links and images: [text](url) / ![alt](url) => text (url)
  text = text.replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (_match, label: string, url: string) => {
    const t = label.trim()
    return t ? `${t} (${url})` : url
  })

  // Bold: **text** and __text__ => WA bold placeholder (avoids collision with italic step)
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '\x01$1\x01')
  text = text.replace(/__([^_\n]+)__/g, '\x01$1\x01')

  // Italic: *text* (single asterisks remaining after ** consumed) => _text_
  text = text.replace(/\*([^*\n]+)\*/g, '_$1_')

  // Strikethrough: ~~text~~ => ~text~
  text = text.replace(/~~([^~\n]+)~~/g, '~$1~')

  // Horizontal rules: standalone --- / *** / ___ => remove ([ \t]* avoids consuming trailing \n)
  text = text.replace(/^(-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')

  // Restore bold placeholders
  text = text.replace(/\x01([^\x01]+)\x01/g, '*$1*')

  // Restore inline code and code blocks
  for (let i = 0; i < inlineCodes.length; i++) {
    text = text.replace(`\x00IC${i}\x00`, inlineCodes[i])
  }
  for (let i = 0; i < codeBlocks.length; i++) {
    text = text.replace(`\x00CB${i}\x00`, codeBlocks[i])
  }

  return text
}

// ─── Document helpers ─────────────────────────────────────────────────────────

/** Returns filename + MIME for a document reply based on content and user preference. */
export function pickDocumentFilename(
  text: string,
  format: 'auto' | 'md' | 'txt' = 'auto',
): { name: string; mime: string } {
  if (format === 'txt') return { name: 'response.txt', mime: 'text/plain' }
  if (format === 'md') return { name: 'response.md', mime: 'text/markdown' }

  // auto: detect markdown by common markers
  const looksLikeMarkdown =
    /^#{1,6} /m.test(text) ||       // headings
    /\*\*[^*]+\*\*/m.test(text) ||  // bold
    /^```/m.test(text) ||           // code block
    /^- /m.test(text) ||            // list
    /^\d+\. /m.test(text)           // ordered list

  return looksLikeMarkdown
    ? { name: 'response.md', mime: 'text/markdown' }
    : { name: 'response.txt', mime: 'text/plain' }
}

/** Returns true when text length triggers the document threshold.
 *  undefined → use DEFAULT_DOCUMENT_THRESHOLD (enabled by default).
 *  0 → disabled. -1 → always. */
export function shouldSendAsDocument(text: string, threshold: number | undefined): boolean {
  const t = threshold ?? DEFAULT_DOCUMENT_THRESHOLD
  if (t === 0) return false
  if (t === -1) return true
  return text.length > t
}
