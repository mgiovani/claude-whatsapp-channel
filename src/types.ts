/**
 * Shared types and Zod schemas used across modules.
 */

import { z } from 'zod'

// ─── Access control types ──────────────────────────────────────────────────────

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
  /** Char length above which reply sends as a document. 0 = disabled (default). -1 = always. */
  documentThreshold?: number
  /** File format for document replies. 'auto' picks md vs txt by content. */
  documentFormat?: 'auto' | 'md' | 'txt'
}

export type GateResult =
  | { action: 'deliver'; access: Access }
  | { action: 'drop'; reason?: string }
  | { action: 'pair'; code: string; isResend: boolean; pendingEntry: PendingEntry; access: Access }

export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'sticker'

// ─── Connection state type ────────────────────────────────────────────────────

export type WaState = {
  status: string
  myJid?: string
  pairingCode?: string
}

// ─── Permission relay schema ──────────────────────────────────────────────────

export const PermissionRequestSchema = z.object({
  method: z.literal('notifications/claude/channel/permission_request'),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})
