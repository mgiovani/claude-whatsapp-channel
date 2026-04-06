/**
 * All shared constants: limits, MIME maps, extension sets, emoji sets, regexes.
 */

// ─── Message limits ───────────────────────────────────────────────────────────

export const MAX_CHUNK_LIMIT = 4096
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
/** Default char threshold above which replies are sent as document attachments. Set documentThreshold=0 to disable. */
export const DEFAULT_DOCUMENT_THRESHOLD = 4000

// ─── Media ────────────────────────────────────────────────────────────────────

export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
  'video/mp4': 'mp4', 'video/3gpp': '3gp',
  'audio/ogg; codecs=opus': 'ogg', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
}

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp'])
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm'])
export const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.m4a', '.wav', '.aac', '.opus'])

// ─── Permission relay ─────────────────────────────────────────────────────────

export const APPROVE_EMOJI = new Set(['✅', '👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'])
export const DENY_EMOJI = new Set(['❌', '👎', '👎🏻', '👎🏼', '👎🏽', '👎🏾', '👎🏿'])

/** How long permission requests stay open for emoji/text verdicts. */
export const PERMISSION_TTL_MS = 5 * 60 * 1000

// Text-based fallback for permission verdicts. Matches "y/yes/n/no <5-letter-id>".
// ID alphabet: [a-km-z] (skips l to avoid 1/l confusion on mobile keyboards).
export const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

// ─── In-memory cache limits ───────────────────────────────────────────────────

export const MAX_RECENT = 200
export const MAX_SENT = 200
export const MAX_LID_CACHE = 500
