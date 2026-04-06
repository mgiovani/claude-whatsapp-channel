import { describe, test, expect } from 'bun:test'
import {
  safeName,
  bareJid,
  isLidJid,
  jidPhone,
  jidMatch,
  jidListIncludes,
} from './jid.ts'

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

// ─── isLidJid ─────────────────────────────────────────────────────────────────

describe('isLidJid', () => {
  test('returns true for @lid JID', () => {
    expect(isLidJid('6141853589608@lid')).toBe(true)
  })

  test('returns false for @s.whatsapp.net JID', () => {
    expect(isLidJid('5511999999999@s.whatsapp.net')).toBe(false)
  })

  test('returns false for group JID', () => {
    expect(isLidJid('120363xxxxxxx@g.us')).toBe(false)
  })
})

// ─── jidMatch ─────────────────────────────────────────────────────────────────

describe('jidMatch', () => {
  test('does NOT match same numeric part across different domains (LID ≠ phone)', () => {
    // LID numbers are internal identifiers unrelated to phone numbers
    expect(jidMatch('5511999@s.whatsapp.net', '5511999@lid')).toBe(false)
  })

  test('matches same phone JID with device suffix', () => {
    expect(jidMatch('5511999:0@s.whatsapp.net', '5511999@s.whatsapp.net')).toBe(true)
  })

  test('matches same LID JID with device suffix', () => {
    expect(jidMatch('6141853:0@lid', '6141853@lid')).toBe(true)
  })

  test('rejects different phone numbers on same domain', () => {
    expect(jidMatch('5511111@s.whatsapp.net', '5511222@s.whatsapp.net')).toBe(false)
  })
})

// ─── jidListIncludes ──────────────────────────────────────────────────────────

describe('jidListIncludes', () => {
  test('does NOT match across @lid and @s.whatsapp.net domains', () => {
    // LID numbers are not phone numbers — cross-domain match would be incorrect
    const list = ['5511999@s.whatsapp.net']
    expect(jidListIncludes(list, '5511999@lid')).toBe(false)
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
    expect(jidListIncludes(list, '5511999:0@s.whatsapp.net')).toBe(true)
  })
})
