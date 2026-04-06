/**
 * WhatsApp connection lifecycle, shared mutable state, LID resolution,
 * single-instance lock, approval polling, and graceful shutdown.
 */

import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from 'fs'
import { join } from 'path'
import pino from 'pino'
import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
} from './baileys.ts'
import { bareJid, isLidJid } from './jid.ts'
import { loadAccess, saveAccess, loadState, saveState } from './access.ts'
import { storeRecent } from './util.ts'
import {
  MAX_LID_CACHE,
  MAX_RECENT,
  MAX_SENT,
} from './constants.ts'
import {
  AUTH_DIR,
  APPROVED_DIR,
  QR_FILE,
  STATE_DIR,
  LOCK_FILE,
  WHATSAPP_PHONE,
} from './config.ts'

// ─── Shared mutable state ─────────────────────────────────────────────────────

let sock: WASocket | null = null
let isConnected = false
let reconnectAttempt = 0
let replaceCount = 0
let shuttingDown = false
let channelMode = false

// Recent inbound messages — needed for media download, reactions, and quoting.
// Keyed by message ID, capped to prevent unbounded growth.
export const recentMessages = new Map<string, any>()

// Sent message keys — needed for edit_message (WhatsApp requires the original key).
export const sentKeys = new Map<string, any>()

// LID-to-phone JID cache — populated from Alt fields on incoming messages.
// LID JIDs (@lid) are internal WhatsApp identifiers unrelated to phone numbers.
// Baileys v7 provides the phone JID in participantAlt / remoteJidAlt when
// the message is addressed in LID mode.
export const lidToPhone = new Map<string, string>()

// ─── State accessors ──────────────────────────────────────────────────────────

export function getSock(): WASocket | null { return sock }
export function getIsConnected(): boolean { return isConnected }
export function getChannelMode(): boolean { return channelMode }
export function setChannelMode(v: boolean): void { channelMode = v }
export function setShuttingDown(v: boolean): void { shuttingDown = v }

// ─── JID resolution ───────────────────────────────────────────────────────────

// Resolve the sender and chat JIDs from a message, preferring phone-based
// (@s.whatsapp.net) JIDs over LID JIDs wherever Baileys provides both.
export function resolvePhoneJid(msg: any): { senderId: string; chatId: string } {
  const key = msg.key
  const remoteJid: string = key.remoteJid!
  const isGroup = remoteJid.endsWith('@g.us')

  let senderId: string
  let chatId: string

  if (isGroup) {
    chatId = remoteJid
    // participantAlt carries the phone JID when participant is a LID
    senderId = bareJid(key.participantAlt || key.participant || remoteJid)
  } else {
    // remoteJidAlt carries the phone JID when remoteJid is a LID
    const resolved = key.remoteJidAlt || remoteJid
    senderId = bareJid(resolved)
    chatId = senderId
  }

  // Cache any LID-to-phone mapping so we can resolve future messages
  // that arrive without Alt fields (edge case: old protocol fallback).
  const lidJid = isGroup ? key.participant : remoteJid
  const phoneJid = isGroup ? key.participantAlt : key.remoteJidAlt
  if (lidJid && phoneJid && isLidJid(lidJid) && !isLidJid(phoneJid)) {
    const k = bareJid(lidJid)
    lidToPhone.set(k, bareJid(phoneJid))
    if (lidToPhone.size > MAX_LID_CACHE) {
      const oldest = lidToPhone.keys().next().value
      if (oldest !== undefined) lidToPhone.delete(oldest)
    }
  }

  // Fallback: if senderId is still @lid with no Alt, check the cache
  if (isLidJid(senderId)) {
    const cached = lidToPhone.get(senderId)
    if (cached) {
      senderId = cached
      if (!isGroup) chatId = cached
    } else {
      process.stderr.write(`whatsapp channel: unresolved LID JID ${senderId} — no Alt field and not in cache\n`)
    }
  }

  return { senderId, chatId }
}

// ─── Connection utilities ──────────────────────────────────────────────────────

// Wait for the WhatsApp connection to be available, polling briefly.
// Covers brief disconnects (e.g. connectionReplaced) where Baileys reconnects
// within seconds — avoids failing the MCP tool call prematurely.
export async function waitForConnection(timeoutMs = 10_000): Promise<void> {
  if (sock && isConnected) return
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 500))
    if (sock && isConnected) return
  }
  throw new Error('WhatsApp not connected (timed out waiting for reconnection)')
}

export async function safeSend(jid: string, text: string): Promise<void> {
  await waitForConnection()
  await sock!.sendMessage(jid, { text })
}

export function teardownSocket(): void {
  if (!sock) return
  sock.ev.removeAllListeners()
  try { sock.end(undefined) } catch {}
  sock = null
  isConnected = false
}

// ─── Contact LID caching ──────────────────────────────────────────────────────

function cacheContactLids(contacts: { id?: string; lid?: string }[]): void {
  for (const c of contacts) {
    if (!c.id || !c.lid) continue
    const phone = bareJid(c.id)
    const lid = bareJid(c.lid)
    if (!isLidJid(lid) || isLidJid(phone)) continue
    lidToPhone.set(lid, phone)
    if (lidToPhone.size > MAX_LID_CACHE) {
      const oldest = lidToPhone.keys().next().value
      if (oldest !== undefined) lidToPhone.delete(oldest)
    }
  }
  // Replace any LID JIDs in allowFrom with their resolved phone JIDs.
  // This handles the case where a pairing was approved before the cache
  // was built (i.e., the first message arrived without remoteJidAlt).
  const access = loadAccess()
  let changed = false
  for (let i = 0; i < access.allowFrom.length; i++) {
    const jid = access.allowFrom[i]
    if (isLidJid(jid)) {
      const phone = lidToPhone.get(jid)
      if (phone) { access.allowFrom[i] = phone; changed = true }
    }
  }
  if (changed) saveAccess(access)
}

// ─── WhatsApp connection ──────────────────────────────────────────────────────

export async function connectWhatsApp(hooks: {
  onMessage: (msg: any) => Promise<void>
  onReaction: (reactions: any[]) => void
}): Promise<void> {
  if (shuttingDown) return
  teardownSocket()
  mkdirSync(AUTH_DIR, { recursive: true, mode: 0o700 })

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const logger = pino({ level: 'silent' }) // Silence Baileys internal noise.

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    printQRInTerminal: false,
    browser: ['Claude Code', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false,        // Don't suppress phone notifications.
    logger,
    cachedGroupMetadata: async () => null,
    getMessage: async key => {
      const id = key.id ?? ''
      return recentMessages.get(id)?.message ?? undefined
    },
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('contacts.upsert', cacheContactLids)
  sock.ev.on('contacts.update', cacheContactLids)
  sock.ev.on('messaging-history.set', ({ contacts }) => cacheContactLids(contacts ?? []))

  let pairingCodeRequested = false

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(QR_FILE, qr)
      saveState({ ...loadState(), status: 'awaiting_qr' })
      process.stderr.write('whatsapp channel: QR ready — run /whatsapp:configure qr to display\n')

      // Pairing code flow: if WHATSAPP_PHONE is set, request code instead of QR.
      if (WHATSAPP_PHONE && !pairingCodeRequested) {
        pairingCodeRequested = true
        try {
          const digits = WHATSAPP_PHONE.replace(/\D/g, '')
          const code = await sock!.requestPairingCode(digits)
          saveState({ ...loadState(), pairingCode: code })
          process.stderr.write('whatsapp channel: pairing code ready — run /whatsapp:configure to see it\n')
        } catch (err) {
          process.stderr.write(`whatsapp channel: pairing code request failed: ${err}\n`)
        }
      }
    }

    if (connection === 'open') {
      isConnected = true
      reconnectAttempt = 0
      replaceCount = 0
      const myJid = sock!.user?.id ?? ''
      saveState({ status: 'connected', myJid })
      try { rmSync(QR_FILE, { force: true }) } catch {}
      process.stderr.write(`whatsapp channel: connected as ${myJid}\n`)
    }

    if (connection === 'close') {
      isConnected = false
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode

      if (statusCode === DisconnectReason.loggedOut) {
        saveState({ ...loadState(), status: 'logged_out' })
        process.stderr.write('whatsapp channel: logged out — clearing auth and generating new QR\n')
        // Clear auth so next connect generates a fresh QR.
        try { rmSync(AUTH_DIR, { recursive: true, force: true }) } catch {}
        // Auto-reconnect to generate fresh QR codes (no manual restart needed).
        setTimeout(() => {
          connectWhatsApp(hooks).catch(err =>
            process.stderr.write(`whatsapp channel: reconnect after logout failed: ${err}\n`),
          )
        }, 2000)
        return
      }

      if (shuttingDown) return

      const reason = DisconnectReason[statusCode as keyof typeof DisconnectReason] ?? String(statusCode)
      saveState({ ...loadState(), status: `disconnected:${reason}` })

      if (statusCode === DisconnectReason.connectionReplaced) {
        replaceCount++
        if (replaceCount >= 3) {
          process.stderr.write(
            'whatsapp channel: connection replaced 3 times consecutively — stopping reconnect (likely another active session)\n',
          )
          return
        }
        process.stderr.write(`whatsapp channel: connection replaced — reconnecting in 3s (attempt ${replaceCount}/3)\n`)
        reconnectAttempt = 0
        setTimeout(() => {
          connectWhatsApp(hooks).catch(err =>
            process.stderr.write(`whatsapp channel: reconnect after replace failed: ${err}\n`),
          )
        }, 3000)
        return
      }

      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30_000)
      process.stderr.write(
        `whatsapp channel: disconnected (${reason}), reconnecting in ${delay / 1000}s (attempt ${reconnectAttempt + 1})\n`,
      )
      reconnectAttempt++
      setTimeout(() => {
        connectWhatsApp(hooks).catch(err =>
          process.stderr.write(`whatsapp channel: reconnect failed: ${err}\n`),
        )
      }, delay)
    }
  })

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe) continue                         // Skip own messages.
      if (msg.key.remoteJid === 'status@broadcast') continue // Skip status updates.
      hooks.onMessage(msg).catch(err =>
        process.stderr.write(`whatsapp channel: handleInbound failed: ${err}\n`),
      )
    }
  })

  sock.ev.on('messages.reaction', hooks.onReaction)
}

// ─── Single-instance lock ─────────────────────────────────────────────────────
// Prevents two Claude sessions from sharing the same Baileys connection, which
// causes connectionReplaced storms. Uses O_EXCL for atomic acquisition; stale
// locks (dead PID) are silently cleared.

export function acquireLock(): boolean {
  try {
    // Atomic create — fails if file already exists.
    const fd = openSync(LOCK_FILE, 'wx')
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
    return true
  } catch {
    // File exists — check whether that process is still alive.
    try {
      const existing = parseInt(readFileSync(LOCK_FILE, 'utf8').trim(), 10)
      if (!isNaN(existing) && existing !== process.pid) {
        try {
          process.kill(existing, 0) // signal 0 = existence check only
          return false              // process is alive → conflict
        } catch {
          // Process is gone (ESRCH) — stale lock. Clear and retry once.
          rmSync(LOCK_FILE, { force: true })
          const fd = openSync(LOCK_FILE, 'wx')
          writeFileSync(fd, String(process.pid))
          closeSync(fd)
          return true
        }
      }
    } catch {
      // Unreadable or already gone — treat as free.
    }
    return true
  }
}

export function releaseLock(): void {
  try { rmSync(LOCK_FILE, { force: true }) } catch {}
}

// ─── Approval polling ─────────────────────────────────────────────────────────
// /whatsapp:access pair <code> drops a file at approved/<senderId> with chatId
// as file contents. We poll, send "Paired!" confirmation, then clean up.

export function checkApprovals(): void {
  let files: string[]
  try { files = readdirSync(APPROVED_DIR) } catch { return }
  if (files.length === 0) return

  for (const rawSenderId of files) {
    const file = join(APPROVED_DIR, rawSenderId)
    let rawChatId: string
    try { rawChatId = readFileSync(file, 'utf8').trim() || rawSenderId } catch { continue }

    // Resolve LID JIDs to phone JIDs now that the cache may be populated.
    const senderId = (isLidJid(rawSenderId) && lidToPhone.get(rawSenderId)) || rawSenderId
    const chatId = (isLidJid(rawChatId) && lidToPhone.get(rawChatId)) || rawChatId

    // If the allowFrom entry was stored as a LID, replace it with the phone JID.
    if (senderId !== rawSenderId) {
      const access = loadAccess()
      const idx = access.allowFrom.indexOf(rawSenderId)
      if (idx !== -1) {
        access.allowFrom[idx] = senderId
        saveAccess(access)
      }
    }

    void safeSend(chatId, 'Paired! Say hi to Claude.').then(
      () => rmSync(file, { force: true }),
      err => {
        process.stderr.write(`whatsapp channel: failed to send approval confirm: ${err}\n`)
        rmSync(file, { force: true }) // Remove anyway — don't loop on a broken send.
      },
    )
  }
}

// ─── Shutdown ─────────────────────────────────────────────────────────────────
// When Claude Code closes the MCP connection, stdin gets EOF. Without this
// the Baileys WS stays open as a zombie.

export function shutdown(): void {
  if (shuttingDown) return
  shuttingDown = true
  if (channelMode) {
    releaseLock()
    try { sock?.end(new Error('shutdown')) } catch {}
  }
  process.stderr.write('whatsapp channel: shutting down\n')
  setTimeout(() => process.exit(0), 2000)
  void Promise.resolve().finally(() => process.exit(0))
}

// ─── Store helpers ────────────────────────────────────────────────────────────
// Convenience wrappers that use the module-level maps and caps.

export function storeInboundMessage(id: string, msg: any): void {
  storeRecent(id, msg, recentMessages, MAX_RECENT)
}

export function storeSentKey(id: string, key: any): void {
  storeRecent(id, key, sentKeys, MAX_SENT)
}
