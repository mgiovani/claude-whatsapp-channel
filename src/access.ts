/**
 * Access control: in-memory logic (gate, defaultAccess, pruneExpired)
 * and filesystem I/O (loadAccess, saveAccess, loadState, saveState).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs'
import { randomBytes } from 'crypto'
import type { Access, GateResult, PendingEntry, WaState } from './types.ts'
import { jidMatch, jidListIncludes, isLidJid } from './jid.ts'
import { ACCESS_FILE, STATE_DIR, STATE_FILE } from './config.ts'

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

// ─── Access file I/O ──────────────────────────────────────────────────────────

export function readAccessFile(): Access {
  try {
    const raw = readFileSync(ACCESS_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<Access>
    return {
      dmPolicy: parsed.dmPolicy ?? 'pairing',
      allowFrom: parsed.allowFrom ?? [],
      groups: parsed.groups ?? {},
      pending: parsed.pending ?? {},
      mentionPatterns: parsed.mentionPatterns,
      ackReaction: parsed.ackReaction,
      replyToMode: parsed.replyToMode,
      textChunkLimit: parsed.textChunkLimit,
      chunkMode: parsed.chunkMode,
      documentThreshold: parsed.documentThreshold,
      documentFormat: parsed.documentFormat,
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultAccess()
    try { renameSync(ACCESS_FILE, `${ACCESS_FILE}.corrupt-${Date.now()}`) } catch {}
    process.stderr.write('whatsapp channel: access.json is corrupt, moved aside. Starting fresh.\n')
    return defaultAccess()
  }
}

export function loadAccess(): Access {
  return readAccessFile()
}

export function saveAccess(a: Access): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const tmp = ACCESS_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(a, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, ACCESS_FILE)
}

// ─── Connection state I/O ─────────────────────────────────────────────────────
// Consolidated state.json replaces the old me.txt / status.txt / pairing_code.txt
// trio. Each field is optional so a partial update never loses other fields.

export function loadState(): WaState {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as WaState
  } catch {
    return { status: 'disconnected' }
  }
}

export function saveState(s: WaState): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 })
  const tmp = STATE_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, STATE_FILE)
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
    // This handles reconnect scenarios where the in-memory LID=>phone cache is empty
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
