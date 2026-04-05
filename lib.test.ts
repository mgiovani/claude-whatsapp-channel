import { describe, test, expect } from 'bun:test'
import {
  safeName,
  bareJid,
  jidPhone,
  jidMatch,
  jidListIncludes,
  extractText,
  getMediaKind,
  getMediaMime,
  getMediaFileName,
  mimeToExt,
  chunk,
  storeRecent,
  defaultAccess,
  pruneExpired,
  gate,
  type Access,
} from './lib.ts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create an in-memory accessIO for testing gate() without touching the filesystem */
function makeIO(initial?: Partial<Access>) {
  let access: Access = { ...defaultAccess(), ...initial }
  const saved: Access[] = []
  return {
    io: {
      load: () => ({ ...access, pending: { ...access.pending }, allowFrom: [...access.allowFrom], groups: { ...access.groups } }),
      save: (a: Access) => { access = a; saved.push(a) },
    },
    get current() { return access },
    saved,
  }
}

const FUTURE = Date.now() + 60 * 60 * 1000
const PAST = Date.now() - 1

// ─── safeName ─────────────────────────────────────────────────────────────────

describe('safeName', () => {
  test('strips angle brackets', () => {
    expect(safeName('<script>')).toBe('_script_')
  })

  test('strips square brackets', () => {
    expect(safeName('[admin]')).toBe('_admin_')
  })

  test('strips semicolons', () => {
    expect(safeName('foo;bar')).toBe('foo_bar')
  })

  test('strips carriage return and newline', () => {
    expect(safeName('foo\r\nbar')).toBe('foo__bar')
  })

  test('passes clean strings unchanged', () => {
    expect(safeName('Alice')).toBe('Alice')
  })

  test('returns undefined for undefined input', () => {
    expect(safeName(undefined)).toBeUndefined()
  })
})

// ─── bareJid ──────────────────────────────────────────────────────────────────

describe('bareJid', () => {
  // WhatsApp device suffix format is phone:device@domain (e.g. 5511999:0@s.whatsapp.net)
  test('strips device suffix :0', () => {
    expect(bareJid('5511999:0@s.whatsapp.net')).toBe('5511999@s.whatsapp.net')
  })

  test('strips device suffix :1', () => {
    expect(bareJid('5511999:1@s.whatsapp.net')).toBe('5511999@s.whatsapp.net')
  })

  test('leaves JID without suffix unchanged', () => {
    expect(bareJid('5511999@s.whatsapp.net')).toBe('5511999@s.whatsapp.net')
  })

  test('works with @lid domain', () => {
    expect(bareJid('1234567:3@lid')).toBe('1234567@lid')
  })
})

// ─── jidPhone ─────────────────────────────────────────────────────────────────

describe('jidPhone', () => {
  test('extracts phone from @s.whatsapp.net JID', () => {
    expect(jidPhone('5511999999999@s.whatsapp.net')).toBe('5511999999999')
  })

  test('extracts phone from @lid JID', () => {
    expect(jidPhone('6141853589608@lid')).toBe('6141853589608')
  })

  test('strips device suffix', () => {
    expect(jidPhone('5511999999999:2@s.whatsapp.net')).toBe('5511999999999')
  })
})

// ─── jidMatch ─────────────────────────────────────────────────────────────────

describe('jidMatch', () => {
  test('matches same phone on different domains', () => {
    expect(jidMatch('5511999@s.whatsapp.net', '5511999@lid')).toBe(true)
  })

  test('matches same phone with device suffix', () => {
    expect(jidMatch('5511999@s.whatsapp.net:0', '5511999@s.whatsapp.net')).toBe(true)
  })

  test('rejects different phone numbers', () => {
    expect(jidMatch('5511111@s.whatsapp.net', '5511222@s.whatsapp.net')).toBe(false)
  })
})

// ─── jidListIncludes ──────────────────────────────────────────────────────────

describe('jidListIncludes', () => {
  test('finds a match when domains differ', () => {
    const list = ['5511999@s.whatsapp.net']
    expect(jidListIncludes(list, '5511999@lid')).toBe(true)
  })

  test('returns false for empty list', () => {
    expect(jidListIncludes([], '5511999@s.whatsapp.net')).toBe(false)
  })

  test('returns false when not present', () => {
    const list = ['5511111@s.whatsapp.net']
    expect(jidListIncludes(list, '5511222@s.whatsapp.net')).toBe(false)
  })

  test('finds match with device suffix', () => {
    const list = ['5511999@s.whatsapp.net']
    expect(jidListIncludes(list, '5511999@s.whatsapp.net:0')).toBe(true)
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

// ─── storeRecent ──────────────────────────────────────────────────────────────

describe('storeRecent', () => {
  test('stores and retrieves by ID', () => {
    const map = new Map<string, any>()
    storeRecent('id1', { text: 'hi' }, map, 10)
    expect(map.get('id1')).toEqual({ text: 'hi' })
  })

  test('evicts oldest when over capacity', () => {
    const map = new Map<string, any>()
    storeRecent('id1', 'first', map, 2)
    storeRecent('id2', 'second', map, 2)
    storeRecent('id3', 'third', map, 2) // should evict id1
    expect(map.has('id1')).toBe(false)
    expect(map.has('id2')).toBe(true)
    expect(map.has('id3')).toBe(true)
  })

  test('keeps all entries below capacity', () => {
    const map = new Map<string, any>()
    storeRecent('a', 1, map, 5)
    storeRecent('b', 2, map, 5)
    expect(map.size).toBe(2)
  })
})

// ─── defaultAccess ────────────────────────────────────────────────────────────

describe('defaultAccess', () => {
  test('returns correct shape', () => {
    const a = defaultAccess()
    expect(a.dmPolicy).toBe('pairing')
    expect(a.allowFrom).toEqual([])
    expect(a.groups).toEqual({})
    expect(a.pending).toEqual({})
  })
})

// ─── pruneExpired ─────────────────────────────────────────────────────────────

describe('pruneExpired', () => {
  test('removes expired entries', () => {
    const a = defaultAccess()
    a.pending['abc'] = { senderId: 'x', chatId: 'x', createdAt: PAST - 1000, expiresAt: PAST, replies: 1 }
    expect(pruneExpired(a)).toBe(true)
    expect(a.pending['abc']).toBeUndefined()
  })

  test('keeps non-expired entries', () => {
    const a = defaultAccess()
    a.pending['abc'] = { senderId: 'x', chatId: 'x', createdAt: Date.now(), expiresAt: FUTURE, replies: 1 }
    expect(pruneExpired(a)).toBe(false)
    expect(a.pending['abc']).toBeDefined()
  })

  test('returns false when nothing pruned', () => {
    const a = defaultAccess()
    expect(pruneExpired(a)).toBe(false)
  })
})

// ─── gate: DM policies ────────────────────────────────────────────────────────

describe('gate — DM policy: disabled', () => {
  test('drops all DMs', () => {
    const { io } = makeIO({ dmPolicy: 'disabled' })
    const result = gate('5511@s.whatsapp.net', 'private', '5511@s.whatsapp.net', false, io)
    expect(result.action).toBe('drop')
  })
})

describe('gate — DM policy: allowlist', () => {
  test('delivers when sender is in allowFrom', () => {
    const { io } = makeIO({ dmPolicy: 'allowlist', allowFrom: ['5511@s.whatsapp.net'] })
    const result = gate('5511@s.whatsapp.net', 'private', '5511@s.whatsapp.net', false, io)
    expect(result.action).toBe('deliver')
  })

  test('drops when sender is not in allowFrom', () => {
    const { io } = makeIO({ dmPolicy: 'allowlist', allowFrom: ['5511111@s.whatsapp.net'] })
    const result = gate('5511222@s.whatsapp.net', 'private', '5511222@s.whatsapp.net', false, io)
    expect(result.action).toBe('drop')
  })

  test('matches across @lid and @s.whatsapp.net domains', () => {
    const { io } = makeIO({ dmPolicy: 'allowlist', allowFrom: ['5511999@s.whatsapp.net'] })
    const result = gate('5511999@lid', 'private', '5511999@lid', false, io)
    expect(result.action).toBe('deliver')
  })
})

describe('gate — DM policy: pairing', () => {
  test('delivers when sender is already in allowFrom', () => {
    const { io } = makeIO({ dmPolicy: 'pairing', allowFrom: ['5511@s.whatsapp.net'] })
    const result = gate('5511@s.whatsapp.net', 'private', '5511@s.whatsapp.net', false, io)
    expect(result.action).toBe('deliver')
  })

  test('creates new pairing code for unknown sender', () => {
    const { io } = makeIO({ dmPolicy: 'pairing' })
    const result = gate('5511@s.whatsapp.net', 'private', '5511@s.whatsapp.net', false, io)
    expect(result.action).toBe('pair')
    if (result.action === 'pair') {
      expect(result.isResend).toBe(false)
      expect(result.code).toMatch(/^[0-9a-f]{6}$/)
    }
  })

  test('saves access after creating new pending entry', () => {
    const { io, saved } = makeIO({ dmPolicy: 'pairing' })
    gate('5511@s.whatsapp.net', 'private', '5511@s.whatsapp.net', false, io)
    expect(saved.length).toBeGreaterThan(0)
  })

  test('returns existing code as resend for sender with pending entry', () => {
    const { io } = makeIO({
      dmPolicy: 'pairing',
      pending: {
        'abc123': { senderId: '5511@s.whatsapp.net', chatId: '5511@s.whatsapp.net', createdAt: Date.now(), expiresAt: FUTURE, replies: 1 },
      },
    })
    const result = gate('5511@s.whatsapp.net', 'private', '5511@s.whatsapp.net', false, io)
    expect(result.action).toBe('pair')
    if (result.action === 'pair') {
      expect(result.isResend).toBe(true)
      expect(result.code).toBe('abc123')
    }
  })

  test('drops sender that has hit 3 reply attempts', () => {
    const { io } = makeIO({
      dmPolicy: 'pairing',
      pending: {
        'abc123': { senderId: '5511@s.whatsapp.net', chatId: '5511@s.whatsapp.net', createdAt: Date.now(), expiresAt: FUTURE, replies: 3 },
      },
    })
    const result = gate('5511@s.whatsapp.net', 'private', '5511@s.whatsapp.net', false, io)
    expect(result.action).toBe('drop')
  })

  test('drops new senders when 3 pending entries exist', () => {
    const { io } = makeIO({
      dmPolicy: 'pairing',
      pending: {
        'aaa111': { senderId: '111@s.whatsapp.net', chatId: '111@s.whatsapp.net', createdAt: Date.now(), expiresAt: FUTURE, replies: 1 },
        'bbb222': { senderId: '222@s.whatsapp.net', chatId: '222@s.whatsapp.net', createdAt: Date.now(), expiresAt: FUTURE, replies: 1 },
        'ccc333': { senderId: '333@s.whatsapp.net', chatId: '333@s.whatsapp.net', createdAt: Date.now(), expiresAt: FUTURE, replies: 1 },
      },
    })
    const result = gate('444@s.whatsapp.net', 'private', '444@s.whatsapp.net', false, io)
    expect(result.action).toBe('drop')
  })

  test('matches sender across @lid and @s.whatsapp.net for existing pending entry', () => {
    const { io } = makeIO({
      dmPolicy: 'pairing',
      pending: {
        'abc123': { senderId: '5511@s.whatsapp.net', chatId: '5511@s.whatsapp.net', createdAt: Date.now(), expiresAt: FUTURE, replies: 1 },
      },
    })
    // Sender arrives as @lid but stored as @s.whatsapp.net — should match
    const result = gate('5511@lid', 'private', '5511@lid', false, io)
    expect(result.action).toBe('pair')
    if (result.action === 'pair') expect(result.isResend).toBe(true)
  })

  test('prunes expired entries before checking', () => {
    const { io, saved } = makeIO({
      dmPolicy: 'pairing',
      pending: {
        'expired': { senderId: '999@s.whatsapp.net', chatId: '999@s.whatsapp.net', createdAt: PAST - 1000, expiresAt: PAST, replies: 1 },
      },
    })
    // New sender — should succeed (expired entry pruned, slot available)
    const result = gate('5511@s.whatsapp.net', 'private', '5511@s.whatsapp.net', false, io)
    expect(result.action).toBe('pair')
    // saveAccess was called at least once (pruning)
    expect(saved.length).toBeGreaterThan(0)
  })
})

// ─── gate: group policies ─────────────────────────────────────────────────────

describe('gate — group policy', () => {
  const groupJid = '120363@g.us'
  const sender = '5511@s.whatsapp.net'

  test('drops when group not configured', () => {
    const { io } = makeIO()
    const result = gate(sender, 'group', groupJid, true, io)
    expect(result.action).toBe('drop')
  })

  test('delivers when group exists, requireMention=true, and mentioned', () => {
    const { io } = makeIO({ groups: { [groupJid]: { requireMention: true, allowFrom: [] } } })
    const result = gate(sender, 'group', groupJid, true, io)
    expect(result.action).toBe('deliver')
  })

  test('drops when requireMention=true and not mentioned', () => {
    const { io } = makeIO({ groups: { [groupJid]: { requireMention: true, allowFrom: [] } } })
    const result = gate(sender, 'group', groupJid, false, io)
    expect(result.action).toBe('drop')
  })

  test('delivers when requireMention=false regardless of mention', () => {
    const { io } = makeIO({ groups: { [groupJid]: { requireMention: false, allowFrom: [] } } })
    const result = gate(sender, 'group', groupJid, false, io)
    expect(result.action).toBe('deliver')
  })

  test('drops when sender not in group allowFrom list', () => {
    const { io } = makeIO({ groups: { [groupJid]: { requireMention: false, allowFrom: ['9999@s.whatsapp.net'] } } })
    const result = gate(sender, 'group', groupJid, false, io)
    expect(result.action).toBe('drop')
  })

  test('delivers when sender is in group allowFrom list', () => {
    const { io } = makeIO({ groups: { [groupJid]: { requireMention: false, allowFrom: [sender] } } })
    const result = gate(sender, 'group', groupJid, false, io)
    expect(result.action).toBe('deliver')
  })
})
