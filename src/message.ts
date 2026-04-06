/**
 * Pure WhatsApp message helper functions.
 * Unwraps Baileys message wrappers and extracts content/media metadata.
 * No side effects, no filesystem access, no WhatsApp connection.
 */

import type { MediaKind } from './types.ts'
import { safeName } from './jid.ts'
import { MIME_TO_EXT } from './constants.ts'

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

export function getContextInfo(msg: any): any | null {
  const m = unwrapMessage(msg?.message)
  if (!m) return null
  return (
    m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.audioMessage?.contextInfo ??
    m.documentMessage?.contextInfo ??
    m.stickerMessage?.contextInfo ??
    m.contactMessage?.contextInfo ??
    m.locationMessage?.contextInfo ??
    null
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
