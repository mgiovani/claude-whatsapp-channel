/**
 * MCP tool definitions and handlers: reply, react, download_attachment, edit_message.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'fs'
import { extname, basename, join } from 'path'
import pino from 'pino'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { downloadMediaMessage } from './baileys.ts'
import { jidListIncludes, isLidJid } from './jid.ts'
import { getMediaKind, getMediaMime, getMediaFileName, mimeToExt } from './message.ts'
import { chunk, toWhatsAppFormat, pickDocumentFilename, shouldSendAsDocument } from './format.ts'
import { loadAccess } from './access.ts'
import { assertSendable } from './security.ts'
import {
  getSock,
  waitForConnection,
  recentMessages,
  sentKeys,
  lidToPhone,
  storeSentKey,
} from './connection.ts'
import {
  MAX_CHUNK_LIMIT,
  MAX_ATTACHMENT_BYTES,
  IMAGE_EXTS,
  VIDEO_EXTS,
  AUDIO_EXTS,
} from './constants.ts'
import { STATE_DIR, INBOX_DIR } from './config.ts'

// ─── Outbound gate ────────────────────────────────────────────────────────────
// reply/react/edit_message can only target chats the inbound gate would deliver from.

function assertAllowedChat(chat_id: string): void {
  const access = loadAccess()
  if (jidListIncludes(access.allowFrom, chat_id)) return
  if (chat_id in access.groups) return
  // If chat_id is a LID that maps to a phone JID, check the resolved form too.
  if (isLidJid(chat_id)) {
    const phone = lidToPhone.get(chat_id)
    if (phone && jidListIncludes(access.allowFrom, phone)) return
  }
  throw new Error(`chat ${chat_id} is not allowlisted — add via /whatsapp:access`)
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerTools(mcp: Server): void {
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'reply',
        description:
          'Reply on WhatsApp. Pass chat_id from the inbound message. Optionally pass reply_to (message_id) for threading, and files (absolute paths) to attach images or documents.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string' },
            text: { type: 'string' },
            reply_to: {
              type: 'string',
              description: 'Message ID to quote-reply under. Use message_id from the inbound <channel> block.',
            },
            files: {
              type: 'array',
              items: { type: 'string' },
              description:
                'Absolute file paths to attach. Images send as photos (inline preview); videos/audio/other as their respective types. Max 50MB each.',
            },
          },
          required: ['chat_id', 'text'],
        },
      },
      {
        name: 'react',
        description: 'Add an emoji reaction to a WhatsApp message. Requires the message to be in recent history.',
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string' },
            message_id: { type: 'string' },
            emoji: { type: 'string' },
          },
          required: ['chat_id', 'message_id', 'emoji'],
        },
      },
      {
        name: 'download_attachment',
        description:
          'Download a media attachment from a WhatsApp message to the local inbox. Use when the inbound <channel> meta shows attachment_file_id. Returns the local file path ready to Read.',
        inputSchema: {
          type: 'object',
          properties: {
            message_id: {
              type: 'string',
              description: 'The attachment_file_id from the inbound <channel> meta.',
            },
          },
          required: ['message_id'],
        },
      },
      {
        name: 'edit_message',
        description:
          "Edit a message Claude previously sent. Useful for interim progress updates. Edits don't trigger push notifications — send a new reply when a long task completes so the user's device pings.",
        inputSchema: {
          type: 'object',
          properties: {
            chat_id: { type: 'string' },
            message_id: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['chat_id', 'message_id', 'text'],
        },
      },
    ],
  }))

  mcp.setRequestHandler(CallToolRequestSchema, async req => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>
    const sock = getSock()
    try {
      switch (req.params.name) {
        case 'reply': {
          const chat_id = args.chat_id as string
          const text = args.text as string
          const reply_to = args.reply_to as string | undefined
          const files = (args.files as string[] | undefined) ?? []

          assertAllowedChat(chat_id)
          await waitForConnection()

          // Clear the typing indicator before sending.
          void sock!.sendPresenceUpdate('paused', chat_id).catch(() => {})

          for (const f of files) {
            assertSendable(f, STATE_DIR)
            const st = statSync(f)
            if (st.size > MAX_ATTACHMENT_BYTES) {
              throw new Error(`file too large: ${f} (${(st.size / 1024 / 1024).toFixed(1)}MB, max 50MB)`)
            }
          }

          const access = loadAccess()
          const sentIds: string[] = []

          // Resolve quoted message for threading.
          const quotedMsg = reply_to ? recentMessages.get(reply_to) : undefined
          const quoteOpts: Record<string, unknown> = quotedMsg ? { quoted: quotedMsg } : {}

          // Document mode: send as file attachment when text exceeds threshold.
          if (shouldSendAsDocument(text, access.documentThreshold)) {
            const { name, mime } = pickDocumentFilename(text, access.documentFormat ?? 'auto')
            const tmpPath = join(INBOX_DIR, `reply-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`)
            mkdirSync(INBOX_DIR, { recursive: true })
            try {
              writeFileSync(tmpPath, text, 'utf8')
              const buf = readFileSync(tmpPath)
              const sent = await sock!.sendMessage(
                chat_id,
                { document: buf, fileName: name, mimetype: mime },
                quoteOpts,
              )
              const sentId = sent?.key?.id
              if (sentId) {
                sentIds.push(sentId)
                storeSentKey(sentId, sent)
              }
            } finally {
              try { rmSync(tmpPath, { force: true }) } catch {}
            }

            const result =
              sentIds.length === 1
                ? `sent as document (id: ${sentIds[0]})`
                : `sent as document`
            return { content: [{ type: 'text', text: result }] }
          }

          const limit = Math.max(1, Math.min(access.textChunkLimit ?? MAX_CHUNK_LIMIT, MAX_CHUNK_LIMIT))
          const mode = access.chunkMode ?? 'length'
          const replyMode = access.replyToMode ?? 'first'
          const chunks = chunk(text, limit, mode)

          for (let i = 0; i < chunks.length; i++) {
            const shouldQuote = quotedMsg != null && replyMode !== 'off' && (replyMode === 'all' || i === 0)
            const opts: Record<string, unknown> = shouldQuote ? { quoted: quotedMsg } : {}

            if (i > 0) await new Promise(r => setTimeout(r, 500)) // rate-limit chunks

            const sent = await sock!.sendMessage(chat_id, { text: toWhatsAppFormat(chunks[i]) }, opts)
            const sentId = sent?.key?.id
            if (sentId) {
              sentIds.push(sentId)
              storeSentKey(sentId, sent)
            }
          }

          // Files go as separate messages.
          for (const f of files) {
            const ext = extname(f).toLowerCase()
            const buf = readFileSync(f)
            const opts: Record<string, unknown> = quotedMsg ? { quoted: quotedMsg } : {}
            let sent: any

            if (IMAGE_EXTS.has(ext)) {
              sent = await sock!.sendMessage(chat_id, { image: buf }, opts)
            } else if (VIDEO_EXTS.has(ext)) {
              sent = await sock!.sendMessage(chat_id, { video: buf, fileName: basename(f) }, opts)
            } else if (AUDIO_EXTS.has(ext)) {
              sent = await sock!.sendMessage(chat_id, { audio: buf, mimetype: 'audio/mp4' }, opts)
            } else {
              sent = await sock!.sendMessage(
                chat_id,
                { document: buf, fileName: basename(f), mimetype: 'application/octet-stream' },
                opts,
              )
            }

            const sentId = sent?.key?.id
            if (sentId) {
              sentIds.push(sentId)
              storeSentKey(sentId, sent)
            }
          }

          const result =
            sentIds.length === 1
              ? `sent (id: ${sentIds[0]})`
              : `sent ${sentIds.length} parts (ids: ${sentIds.join(', ')})`
          return { content: [{ type: 'text', text: result }] }
        }

        case 'react': {
          assertAllowedChat(args.chat_id as string)
          await waitForConnection()
          const msgId = args.message_id as string

          const storedMsg = recentMessages.get(msgId)
          const key = sentKeys.get(msgId)?.key ?? storedMsg?.key
          if (!key) {
            throw new Error(
              `message ${msgId} not found in recent history — reaction requires the original message key`,
            )
          }

          await sock!.sendMessage(args.chat_id as string, {
            react: { text: args.emoji as string, key },
          })
          return { content: [{ type: 'text', text: 'reacted' }] }
        }

        case 'download_attachment': {
          if (!sock) throw new Error('WhatsApp not connected')
          const msgId = args.message_id as string
          const msg = recentMessages.get(msgId)
          if (!msg) {
            throw new Error(`message ${msgId} not found — only recent messages can be downloaded`)
          }

          const kind = getMediaKind(msg)
          if (!kind) throw new Error('message has no downloadable media')

          const buffer = await downloadMediaMessage(
            msg,
            'buffer',
            {},
            { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage },
          ) as Buffer

          const mime = getMediaMime(msg)
          const ext = mimeToExt(mime)
          const docName = getMediaFileName(msg)
          const safeId = msgId.replace(/[^a-zA-Z0-9_-]/g, '').slice(-12)
          const filename = docName ?? `${Date.now()}-${safeId}.${ext}`

          mkdirSync(INBOX_DIR, { recursive: true })
          const path = join(INBOX_DIR, filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128))
          writeFileSync(path, buffer)
          return { content: [{ type: 'text', text: path }] }
        }

        case 'edit_message': {
          assertAllowedChat(args.chat_id as string)
          await waitForConnection()
          const msgId = args.message_id as string

          const stored = sentKeys.get(msgId)
          if (!stored) {
            throw new Error(
              `message ${msgId} not found in sent history — only Claude's own messages can be edited`,
            )
          }

          await sock!.sendMessage(args.chat_id as string, {
            text: args.text as string,
            edit: stored.key ?? stored,
          })
          return { content: [{ type: 'text', text: `edited (id: ${msgId})` }] }
        }

        default:
          return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text', text: `${req.params.name} failed: ${msg}` }], isError: true }
    }
  })
}
