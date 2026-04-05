/**
 * Pure functions and access control logic extracted from server.ts.
 * Imported by server.ts (runtime) and lib.test.ts (tests).
 *
 * Nothing in this file connects to WhatsApp, reads process.env, or touches
 * the filesystem — except assertSendable (which only reads via realpathSync).
 */

import { randomBytes } from 'crypto'
import { realpathSync } from 'fs'
import { sep } from 'path'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PendingEntry = {
  senderId: string
  chatId: string
  createdAt: number
  expiresAt: number
  replies: number
}

export type GroupPolicy = {
  requireMention: boolean
  allowFrom: string[]
}

export type Access = {
  dmPolicy: 'pairing' | 'allowlist' | 'disabled'
  allowFrom: string[]
  groups: Record<string, GroupPolicy>
  pending: Record<string, PendingEntry>
  mentionPatterns?: string[]
  ackReaction?: string
  replyToMode?: 'off' | 'first' | 'all'
  textChunkLimit?: number
  chunkMode?: 'length' | 'newline'
}

export type GateResult =
  | { action: 'deliver'; access: Access }
  | { action: 'drop'; reason?: string }
  | { action: 'pair'; code: string; isResend: boolean; pendingEntry: PendingEntry; access: Access }

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker'

// ─── Constants ────────────────────────────────────────────────────────────────

export const MAX_CHUNK_LIMIT = 4096
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg; codecs=opus': 'ogg', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
}

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])
export const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.m4a', '.wav', '.aac', '.opus'])

// ─── Access helpers ───────────────────────────────────────────────────────────

export function defaultAccess(): Access {
  return { dmPolicy: 'pairing', allowFrom: [], groups: {}, pending: {} }
}

export function pruneExpired(a: Access): boolean {
  const now = Date.now()
  let changed = false
  for (const [code, p] of Object.entries(a.pending)) {
    if (p.expiresAt < now) { delete a.pending[code]; changed = true }
  }
  return changed
}

// ─── JID helpers ─────────────────────────────────────────────────────────────

// Sanitize user-controlled strings that land inside the <channel> XML tag.
export function safeName(s: string | undefined): string | undefined {
  return s?.replace(/[<>\[\]\r\n;]/g, '_')
}

// Strip device suffix (:0, :1, …) to normalise JIDs for comparison.
export function bareJid(jid: string): string {
  const parts = jid.split('@')
  return parts[0].split(':')[0] + '@' + (parts[1] ?? '')
}

// Returns true if the JID is in LID format (@lid domain).
// LID numbers are internal WhatsApp identifiers, NOT phone numbers.
export function isLidJid(jid: string): boolean {
  return jid.endsWith('@lid')
}

// Extract the numeric phone prefix from a JID.
// NOTE: Only use this for display purposes. For identity comparisons,
// use jidMatch() / jidListIncludes() which are domain-aware.
export function jidPhone(jid: string): string {
  return jid.split('@')[0].split(':')[0]
}

// Check whether two JIDs refer to the same user. Domain-aware: @lid and
// @s.whatsapp.net are different identity spaces and never match each other
// even if the numeric parts happen to be equal.
export function jidMatch(a: string, b: string): boolean {
  return bareJid(a) === bareJid(b)
}

// Check whether a list of JIDs contains one matching a given JID.
export function jidListIncludes(list: string[], jid: string): boolean {
  const norm = bareJid(jid)
  return list.some(j => bareJid(j) === norm)
}

// ─── Message helpers ──────────────────────────────────────────────────────────

// Unwrap Baileys message wrappers (ephemeral, view-once, etc.) to reach the
// inner message object that contains conversation/extendedTextMessage/etc.
export function unwrapMessage(m: any): any {
  if (!m) return m
  return (
    m.ephemeralMessage?.message ??
    m.viewOnceMessage?.message ??
    m.viewOnceMessageV2?.message ??
    m.documentWithCaptionMessage?.message ??
    m.editedMessage?.message ??
    m.protocolMessage?.editedMessage?.message ??
    m
  )
}

// Extract plain text from any WhatsApp message variant.
export function extractText(msg: any): string {
  const m = unwrapMessage(msg?.message)
  if (!m) return ''
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    m.audioMessage?.caption ??
    ''
  )
}

export function getMediaKind(msg: any): MediaKind | null {
  const m = unwrapMessage(msg?.message)
  if (!m) return null
  if (m.imageMessage) return 'image'
  if (m.videoMessage) return 'video'
  if (m.audioMessage) return 'audio'
  if (m.documentMessage) return 'document'
  if (m.stickerMessage) return 'sticker'
  return null
}

export function getMediaMime(msg: any): string | undefined {
  const m = unwrapMessage(msg?.message)
  return (
    m?.imageMessage?.mimetype ??
    m?.videoMessage?.mimetype ??
    m?.audioMessage?.mimetype ??
    m?.documentMessage?.mimetype ??
    m?.stickerMessage?.mimetype
  )
}

export function getMediaFileName(msg: any): string | undefined {
  const m = unwrapMessage(msg?.message)
  return safeName(m?.documentMessage?.fileName)
}

export function mimeToExt(mime: string | undefined): string {
  if (!mime) return 'bin'
  return MIME_TO_EXT[mime] ?? mime.split('/')[1]?.split(';')[0] ?? 'bin'
}

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

// ─── Map helpers ──────────────────────────────────────────────────────────────

export function storeRecent(id: string, msg: any, map: Map<string, any>, cap: number): void {
  map.set(id, msg)
  if (map.size > cap) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
}

// ─── Security ─────────────────────────────────────────────────────────────────

// reply's files param takes any path. .env is a credential and the server's
// own state is the one thing Claude has no reason to ever send.
export function assertSendable(f: string, stateDir: string): void {
  let real, stateReal: string
  try {
    real = realpathSync(f)
    stateReal = realpathSync(stateDir)
  } catch { return }
  const inbox = stateReal + sep + 'inbox'
  if (real.startsWith(stateReal + sep) && !real.startsWith(inbox + sep)) {
    throw new Error(`refusing to send channel state: ${f}`)
  }
}

// ─── Gate ─────────────────────────────────────────────────────────────────────

// gate() operates on normalised WhatsApp JIDs.
// DM JIDs: <phone>@s.whatsapp.net  Group JIDs: <id>@g.us
//
// accessIO is injected so gate() can be tested without touching the filesystem.
// In production (server.ts), pass { load: loadAccess, save: saveAccess }.
// resolveJid is optional: maps a LID JID to its phone JID. Used to detect when
// a LID sender is already in allowFrom under their phone JID (cache may be empty
// on reconnect and remoteJidAlt may be absent from the message key).
export function gate(
  senderId: string,
  chatType: 'private' | 'group',
  chatId: string,
  mentionedMe: boolean,
  accessIO: { load: () => Access; save: (a: Access) => void },
  resolveJid?: (lid: string) => string | undefined,
): GateResult {
  const access = accessIO.load()
  const pruned = pruneExpired(access)
  if (pruned) accessIO.save(access)

  if (chatType === 'private') {
    if (access.dmPolicy === 'disabled') return { action: 'drop', reason: 'disabled' }
    if (jidListIncludes(access.allowFrom, senderId)) return { action: 'deliver', access }
    // If senderId is a LID and we have a resolver, check if its phone JID is allowed.
    // This handles reconnect scenarios where the in-memory LID→phone cache is empty
    // and remoteJidAlt was absent from the message key.
    if (isLidJid(senderId) && resolveJid) {
      const phoneJid = resolveJid(senderId)
      if (phoneJid && jidListIncludes(access.allowFrom, phoneJid)) return { action: 'deliver', access }
    }
    if (access.dmPolicy === 'allowlist') return { action: 'drop', reason: `not in allowlist (allowFrom=${JSON.stringify(access.allowFrom)})` }

    // pairing mode — check for existing non-expired code for this sender
    for (const [code, p] of Object.entries(access.pending)) {
      if (jidMatch(p.senderId, senderId)) {
        // replies is incremented by the caller only after a successful send,
        // so that a failed delivery (connection down) doesn't eat up retries.
        if ((p.replies ?? 1) >= 3) return { action: 'drop' }
        return { action: 'pair', code, isResend: true, pendingEntry: p, access }
      }
    }
    // Cap pending at 3. Extra attempts are silently dropped.
    if (Object.keys(access.pending).length >= 3) return { action: 'drop' }

    const code = randomBytes(3).toString('hex') // 6 hex chars
    const now = Date.now()
    const pendingEntry: PendingEntry = {
      senderId,
      chatId,
      createdAt: now,
      expiresAt: now + 60 * 60 * 1000, // 1h
      replies: 1,
    }
    access.pending[code] = pendingEntry
    accessIO.save(access)
    return { action: 'pair', code, isResend: false, pendingEntry, access }
  }

  if (chatType === 'group') {
    const policy = access.groups[chatId]
    if (!policy) return { action: 'drop' }
    const groupAllowFrom = policy.allowFrom ?? []
    const requireMention = policy.requireMention ?? true
    if (groupAllowFrom.length > 0 && !jidListIncludes(groupAllowFrom, senderId)) {
      return { action: 'drop' }
    }
    if (requireMention && !mentionedMe) return { action: 'drop' }
    return { action: 'deliver', access }
  }

  return { action: 'drop' }
}
