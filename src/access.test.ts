import { describe, test, expect } from 'bun:test'
import {
  defaultAccess,
  pruneExpired,
  gate,
  type Access,
} from './access.ts'

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

  test('drops LID sender not in allowlist (LID ≠ phone — resolution must happen upstream)', () => {
    // resolvePhoneJid() in server.ts converts LID to phone before calling gate().
    // If an unresolved LID reaches gate(), it correctly drops it.
    const { io } = makeIO({ dmPolicy: 'allowlist', allowFrom: ['5511999@s.whatsapp.net'] })
    const result = gate('5511999@lid', 'private', '5511999@lid', false, io)
    expect(result.action).toBe('drop')
  })

  test('delivers LID sender when LID is directly in allowFrom', () => {
    // If the allowlist was built from a LID pairing, same-LID messages still deliver.
    const { io } = makeIO({ dmPolicy: 'allowlist', allowFrom: ['6141853589608@lid'] })
    const result = gate('6141853589608@lid', 'private', '6141853589608@lid', false, io)
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

  test('creates new pairing for LID sender when pending entry is phone-based (no cross-domain match)', () => {
    // LID and phone JIDs are different identity spaces. A LID sender will not match
    // a phone-based pending entry — resolvePhoneJid() must resolve LIDs before gate().
    const { io } = makeIO({
      dmPolicy: 'pairing',
      pending: {
        'abc123': { senderId: '5511@s.whatsapp.net', chatId: '5511@s.whatsapp.net', createdAt: Date.now(), expiresAt: FUTURE, replies: 1 },
      },
    })
    const result = gate('5511@lid', 'private', '5511@lid', false, io)
    expect(result.action).toBe('pair')
    if (result.action === 'pair') expect(result.isResend).toBe(false) // creates new, doesn't match existing
  })

  test('matches sender for existing pending entry (same domain)', () => {
    const { io } = makeIO({
      dmPolicy: 'pairing',
      pending: {
        'abc123': { senderId: '5511@lid', chatId: '5511@lid', createdAt: Date.now(), expiresAt: FUTURE, replies: 1 },
      },
    })
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
