import { describe, test, expect } from 'bun:test'
import {
  unwrapMessage,
  extractText,
  getMediaKind,
  getMediaMime,
  getMediaFileName,
  mimeToExt,
} from './message.ts'

// ─── unwrapMessage ──────────────────────────────────────────────────────────

describe('unwrapMessage', () => {
  test('returns inner message from ephemeralMessage', () => {
    const inner = { conversation: 'hello' }
    expect(unwrapMessage({ ephemeralMessage: { message: inner } })).toBe(inner)
  })

  test('returns inner message from viewOnceMessage', () => {
    const inner = { imageMessage: { caption: 'pic' } }
    expect(unwrapMessage({ viewOnceMessage: { message: inner } })).toBe(inner)
  })

  test('returns inner message from viewOnceMessageV2', () => {
    const inner = { videoMessage: { caption: 'vid' } }
    expect(unwrapMessage({ viewOnceMessageV2: { message: inner } })).toBe(inner)
  })

  test('returns inner message from documentWithCaptionMessage', () => {
    const inner = { documentMessage: { caption: 'doc', fileName: 'f.pdf' } }
    expect(unwrapMessage({ documentWithCaptionMessage: { message: inner } })).toBe(inner)
  })

  test('returns inner message from editedMessage', () => {
    const inner = { conversation: 'edited text' }
    expect(unwrapMessage({ editedMessage: { message: inner } })).toBe(inner)
  })

  test('returns inner message from protocolMessage.editedMessage', () => {
    const inner = { conversation: 'proto edit' }
    expect(unwrapMessage({ protocolMessage: { editedMessage: { message: inner } } })).toBe(inner)
  })

  test('returns original message when no wrapper', () => {
    const m = { conversation: 'plain' }
    expect(unwrapMessage(m)).toBe(m)
  })

  test('returns null/undefined as-is', () => {
    expect(unwrapMessage(null)).toBeNull()
    expect(unwrapMessage(undefined)).toBeUndefined()
  })
})

// ─── extractText ─────────────────────────────────────────────────────────────

describe('extractText', () => {
  test('extracts from conversation field', () => {
    expect(extractText({ message: { conversation: 'hello' } })).toBe('hello')
  })

  test('extracts from extendedTextMessage.text', () => {
    expect(extractText({ message: { extendedTextMessage: { text: 'hi' } } })).toBe('hi')
  })

  test('extracts image caption', () => {
    expect(extractText({ message: { imageMessage: { caption: 'photo' } } })).toBe('photo')
  })

  test('extracts video caption', () => {
    expect(extractText({ message: { videoMessage: { caption: 'vid' } } })).toBe('vid')
  })

  test('extracts document caption', () => {
    expect(extractText({ message: { documentMessage: { caption: 'doc' } } })).toBe('doc')
  })

  test('returns empty string for null message', () => {
    expect(extractText({ message: null })).toBe('')
  })

  test('returns empty string for undefined', () => {
    expect(extractText(undefined)).toBe('')
  })

  test('extracts text from ephemeral wrapper', () => {
    expect(extractText({ message: { ephemeralMessage: { message: { conversation: 'disappearing' } } } })).toBe('disappearing')
  })

  test('extracts text from viewOnce wrapper', () => {
    expect(extractText({ message: { viewOnceMessage: { message: { extendedTextMessage: { text: 'once' } } } } })).toBe('once')
  })

  test('extracts caption from documentWithCaption wrapper', () => {
    expect(extractText({ message: { documentWithCaptionMessage: { message: { documentMessage: { caption: 'see doc' } } } } })).toBe('see doc')
  })

  test('extracts text from editedMessage wrapper', () => {
    expect(extractText({ message: { editedMessage: { message: { conversation: 'fixed typo' } } } })).toBe('fixed typo')
  })
})

// ─── getMediaKind ─────────────────────────────────────────────────────────────

describe('getMediaKind', () => {
  test('returns image for imageMessage', () => {
    expect(getMediaKind({ message: { imageMessage: {} } })).toBe('image')
  })

  test('returns video for videoMessage', () => {
    expect(getMediaKind({ message: { videoMessage: {} } })).toBe('video')
  })

  test('returns audio for audioMessage', () => {
    expect(getMediaKind({ message: { audioMessage: {} } })).toBe('audio')
  })

  test('returns document for documentMessage', () => {
    expect(getMediaKind({ message: { documentMessage: {} } })).toBe('document')
  })

  test('returns sticker for stickerMessage', () => {
    expect(getMediaKind({ message: { stickerMessage: {} } })).toBe('sticker')
  })

  test('returns null for text-only message', () => {
    expect(getMediaKind({ message: { conversation: 'hi' } })).toBeNull()
  })

  test('returns null for null message', () => {
    expect(getMediaKind({ message: null })).toBeNull()
  })

  test('detects image inside ephemeral wrapper', () => {
    expect(getMediaKind({ message: { ephemeralMessage: { message: { imageMessage: {} } } } })).toBe('image')
  })

  test('detects video inside viewOnce wrapper', () => {
    expect(getMediaKind({ message: { viewOnceMessage: { message: { videoMessage: {} } } } })).toBe('video')
  })
})

// ─── getMediaMime ─────────────────────────────────────────────────────────────

describe('getMediaMime', () => {
  test('returns mimetype from imageMessage', () => {
    expect(getMediaMime({ message: { imageMessage: { mimetype: 'image/jpeg' } } })).toBe('image/jpeg')
  })

  test('returns undefined for text message', () => {
    expect(getMediaMime({ message: { conversation: 'hi' } })).toBeUndefined()
  })
})

// ─── getMediaFileName ─────────────────────────────────────────────────────────

describe('getMediaFileName', () => {
  test('returns sanitized fileName from documentMessage', () => {
    expect(getMediaFileName({ message: { documentMessage: { fileName: 'report.pdf' } } })).toBe('report.pdf')
  })

  test('sanitizes dangerous chars in fileName', () => {
    expect(getMediaFileName({ message: { documentMessage: { fileName: '<evil>.pdf' } } })).toBe('_evil_.pdf')
  })

  test('returns undefined for non-document message', () => {
    expect(getMediaFileName({ message: { conversation: 'hi' } })).toBeUndefined()
  })
})

// ─── mimeToExt ────────────────────────────────────────────────────────────────

describe('mimeToExt', () => {
  test('maps image/jpeg to jpg', () => {
    expect(mimeToExt('image/jpeg')).toBe('jpg')
  })

  test('maps audio/ogg; codecs=opus to ogg', () => {
    expect(mimeToExt('audio/ogg; codecs=opus')).toBe('ogg')
  })

  test('maps application/pdf to pdf', () => {
    expect(mimeToExt('application/pdf')).toBe('pdf')
  })

  test('falls back to subtype for unknown MIME', () => {
    expect(mimeToExt('application/zip')).toBe('zip')
  })

  test('returns bin for undefined', () => {
    expect(mimeToExt(undefined)).toBe('bin')
  })
})
