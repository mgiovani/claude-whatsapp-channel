/**
 * Inbound message handling: audio transcription, mention detection,
 * and the main handleInbound pipeline.
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import pino from 'pino'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { downloadMediaMessage } from './baileys.ts'
import { bareJid, isLidJid, safeName } from './jid.ts'
import { extractText, getContextInfo, getMediaKind, getMediaMime } from './message.ts'
import { loadAccess, saveAccess, gate } from './access.ts'
import {
  getSock,
  lidToPhone,
  resolvePhoneJid,
  storeInboundMessage,
} from './connection.ts'
import { PERMISSION_REPLY_RE, MAX_RECENT } from './constants.ts'
import { INBOX_DIR, TRANSCRIPTION_PROVIDER, TRANSCRIPTION_MODEL, TRANSCRIPTION_PROVIDERS } from './config.ts'

// ─── Audio transcription ──────────────────────────────────────────────────────

export async function transcribeAudio(buffer: Buffer, mime?: string): Promise<string | null> {
  const provider = TRANSCRIPTION_PROVIDERS[TRANSCRIPTION_PROVIDER]
  if (!provider) return null

  const apiKey = process.env[provider.keyEnv]
  if (!apiKey) {
    process.stderr.write(`whatsapp channel: transcription: ${provider.keyEnv} not set\n`)
    return null
  }

  try {
    const ext = mime?.includes('ogg') ? 'ogg' : mime?.includes('mp4') ? 'm4a' : mime?.includes('mpeg') ? 'mp3' : 'ogg'
    const blob = new Blob([buffer], { type: mime ?? 'audio/ogg' })
    const form = new FormData()
    form.append('file', blob, `voice.${ext}`)
    form.append('model', TRANSCRIPTION_MODEL ?? provider.defaultModel)
    form.append('response_format', 'json')

    const res = await fetch(provider.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })

    if (!res.ok) {
      process.stderr.write(`whatsapp channel: transcription failed: ${res.status} ${await res.text()}\n`)
      return null
    }

    const json = await res.json() as { text?: string }
    return json.text?.trim() || null
  } catch (err) {
    process.stderr.write(`whatsapp channel: transcription error: ${err}\n`)
    return null
  }
}

// ─── Mention detection ────────────────────────────────────────────────────────

export function isMentioned(msg: any): boolean {
  const sock = getSock()
  const myJid = sock?.user?.id
  if (!myJid) return false
  const myBare = bareJid(myJid)
  // Also check the LID form of our own JID, in case mentions use a different format.
  const myPhone = isLidJid(myJid) ? (lidToPhone.get(myBare) ?? myBare) : myBare

  // Explicit @mention in extendedTextMessage.
  const mentioned: string[] = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? []
  if (mentioned.some((j: string) => {
    const norm = bareJid(j)
    return norm === myBare || norm === myPhone
  })) return true

  // Reply to one of our messages counts as an implicit mention.
  const quoted = msg.message?.extendedTextMessage?.contextInfo?.participant ?? ''
  if (quoted) {
    const norm = bareJid(quoted)
    if (norm === myBare || norm === myPhone) return true
  }

  // Custom text patterns from access.json.
  const access = loadAccess()
  const text = extractText(msg)
  for (const pat of access.mentionPatterns ?? []) {
    try { if (new RegExp(pat, 'i').test(text)) return true } catch {}
  }

  return false
}

// ─── Inbound message handler ──────────────────────────────────────────────────

export async function handleInbound(msg: any, mcp: Server): Promise<void> {
  const sock = getSock()
  const { senderId, chatId } = resolvePhoneJid(msg)
  const isGroup = chatId.endsWith('@g.us')
  const chatType: 'private' | 'group' = isGroup ? 'group' : 'private'

  const mentionedMe = isGroup ? isMentioned(msg) : false
  const result = gate(senderId, chatType, chatId, mentionedMe, { load: loadAccess, save: saveAccess },
    (lid) => lidToPhone.get(lid))

  if (result.action === 'drop') {
    if (result.reason) process.stderr.write(`whatsapp channel: dropped message from ${senderId}: ${result.reason}\n`)
    return
  }

  if (result.action === 'pair') {
    const lead = result.isResend ? 'Still pending' : 'Pairing required'
    try {
      await sock!.sendMessage(chatId, {
        text: `${lead} — run in Claude Code:\n\n/whatsapp:access pair ${result.code}`,
      })
      // Only count a delivery attempt after the send succeeds. If the connection
      // is down and sendMessage throws, we don't increment — so the next message
      // from this sender will retry instead of being silently dropped.
      if (result.isResend) {
        result.pendingEntry.replies = (result.pendingEntry.replies ?? 1) + 1
        saveAccess(result.access)
      }
    } catch (err) {
      process.stderr.write(`whatsapp channel: failed to send pairing code: ${err}\n`)
    }
    return
  }

  const access = result.access
  const msgId = msg.key.id!
  const senderName = safeName(msg.pushName) || senderId.split('@')[0]

  // Store for media download, reactions, and quoting.
  storeInboundMessage(msgId, msg)

  // Ack reaction — lets the user know we received the message. Fire-and-forget.
  if (access.ackReaction) {
    void sock!.sendMessage(chatId, { react: { text: access.ackReaction, key: msg.key } }).catch(() => {})
  }

  // Show typing indicator so the user knows the message landed. Fire-and-forget.
  void sock!.sendPresenceUpdate('composing', chatId).catch(() => {})

  const text = extractText(msg)
  const kind = getMediaKind(msg)

  let imagePath: string | undefined
  let attachmentMeta: Record<string, string> = {}
  let transcription: string | undefined

  // Auto-download images inline (matches Telegram's photo behaviour).
  if (kind === 'image') {
    try {
      const buffer = await downloadMediaMessage(
        msg, 'buffer', {},
        { logger: pino({ level: 'silent' }), reuploadRequest: sock!.updateMediaMessage },
      ) as Buffer
      mkdirSync(INBOX_DIR, { recursive: true })
      const path = join(INBOX_DIR, `${Date.now()}-${msgId.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}.jpg`)
      writeFileSync(path, buffer)
      imagePath = path
    } catch (err) {
      process.stderr.write(`whatsapp channel: image download failed: ${err}\n`)
    }
  } else if (kind === 'audio' && TRANSCRIPTION_PROVIDER !== 'none') {
    // Auto-download + transcribe audio when a provider is configured.
    // attachment_file_id is always included so Claude can still call download_attachment.
    const mime = getMediaMime(msg)
    const docName = msg.message?.audioMessage?.fileName
      ? safeName(msg.message.audioMessage.fileName)
      : undefined
    attachmentMeta = {
      attachment_file_id: msgId,
      attachment_kind: kind,
      ...(mime ? { attachment_mime: mime } : {}),
      ...(docName ? { attachment_name: docName } : {}),
    }
    try {
      const buffer = await downloadMediaMessage(
        msg, 'buffer', {},
        { logger: pino({ level: 'silent' }), reuploadRequest: sock!.updateMediaMessage },
      ) as Buffer
      const transcript = await transcribeAudio(buffer, mime)
      if (transcript) {
        transcription = transcript
        // Save to inbox so download_attachment still works.
        mkdirSync(INBOX_DIR, { recursive: true })
        const audioPath = join(INBOX_DIR, `${Date.now()}-${msgId.replace(/[^a-zA-Z0-9]/g, '').slice(-8)}.ogg`)
        writeFileSync(audioPath, buffer)
      }
    } catch (err) {
      process.stderr.write(`whatsapp channel: audio download/transcription failed: ${err}\n`)
    }
  } else if (kind) {
    // Non-image media: list in meta so Claude can call download_attachment on demand.
    // Keeps notification fast and avoids filling inbox with files nobody looked at.
    const mime = getMediaMime(msg)
    const docName = msg.message?.documentMessage?.fileName
      ? safeName(msg.message.documentMessage.fileName)
      : undefined
    attachmentMeta = {
      attachment_file_id: msgId,
      attachment_kind: kind,
      ...(mime ? { attachment_mime: mime } : {}),
      ...(docName ? { attachment_name: docName } : {}),
    }
  }

  // Intercept permission verdicts before forwarding as chat.
  // Only reachable for delivered (allowlisted) senders, so spoofing is prevented.
  const permMatch = PERMISSION_REPLY_RE.exec(text)
  if (permMatch) {
    void mcp.notification({
      method: 'notifications/claude/channel/permission',
      params: {
        request_id: permMatch[2].toLowerCase(),
        behavior: permMatch[1].toLowerCase().startsWith('y') ? 'allow' : 'deny',
      },
    }).catch(err => process.stderr.write(`whatsapp channel: permission verdict failed: ${err}\n`))
    return
  }

  // Extract quoted/replied-to context if present.
  let quotedPrefix = ''
  let quotedMeta: Record<string, string> = {}
  const ctxInfo = getContextInfo(msg)
  if (ctxInfo?.quotedMessage) {
    const qText = extractText({ message: ctxInfo.quotedMessage })
    const qKind = getMediaKind({ message: ctxInfo.quotedMessage })
    const qSenderJid: string = ctxInfo.participant ?? ''
    const qSenderName = qSenderJid ? qSenderJid.split('@')[0] : ''

    let quoteBody: string
    if (qText) {
      const truncated = qText.length > 200 ? qText.slice(0, 200) + '…' : qText
      quoteBody = `"${truncated}"`
    } else if (qKind) {
      quoteBody = `(${qKind})`
    } else {
      quoteBody = '(message)'
    }

    quotedPrefix = qSenderName
      ? `[Replying to @${qSenderName}: ${quoteBody}]\n\n`
      : `[Replying to: ${quoteBody}]\n\n`

    if (ctxInfo.stanzaId) {
      quotedMeta.quoted_message_id = ctxInfo.stanzaId
    }
  }

  const content = quotedPrefix + (
    text
    || (transcription ? `[Voice message transcription]\n${transcription}\n\n(Original audio available via download_attachment)` : '')
    || (imagePath ? '(photo)' : kind ? `(${kind})` : '(message)')
  )

  // image_path goes in meta only — an in-content annotation is forgeable by any
  // allowlisted sender typing that string.
  void mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content,
      meta: {
        chat_id: chatId,
        message_id: msgId,
        user: senderName,
        user_id: senderId,
        ts: new Date((msg.messageTimestamp as number) * 1000).toISOString(),
        ...(imagePath ? { image_path: imagePath } : {}),
        ...attachmentMeta,
        ...quotedMeta,
      },
    },
  }).catch(err =>
    process.stderr.write(`whatsapp channel: failed to deliver inbound to Claude: ${err}\n`),
  )
}
