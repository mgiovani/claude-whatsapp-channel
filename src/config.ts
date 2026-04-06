/**
 * Path constants, .env loading, and transcription provider configuration.
 * Imported by modules that need filesystem paths or environment variables.
 * The .env loading runs as a side-effect on first import.
 */

import { readFileSync, chmodSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ─── State directory paths ────────────────────────────────────────────────────

export const STATE_DIR = process.env.WHATSAPP_STATE_DIR ?? join(homedir(), '.claude', 'channels', 'whatsapp')
export const ACCESS_FILE = join(STATE_DIR, 'access.json')
export const AUTH_DIR = join(STATE_DIR, 'auth')
export const APPROVED_DIR = join(STATE_DIR, 'approved')
export const INBOX_DIR = join(STATE_DIR, 'inbox')
export const ENV_FILE = join(STATE_DIR, '.env')
export const QR_FILE = join(STATE_DIR, 'qr.txt')
export const STATE_FILE = join(STATE_DIR, 'state.json')
export const LOCK_FILE = join(STATE_DIR, 'server.pid')

// ─── .env loading ─────────────────────────────────────────────────────────────
// Load ~/.claude/channels/whatsapp/.env into process.env. Real env wins.
// Plugin-spawned servers don't get an env block — this is where WHATSAPP_PHONE lives.

try {
  chmodSync(ENV_FILE, 0o600)
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

// ─── Environment variables ────────────────────────────────────────────────────

/** Phone number for pairing-code flow (E.164 digits only, no +). */
export const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE

// ─── Transcription providers ──────────────────────────────────────────────────

export const TRANSCRIPTION_PROVIDER = process.env.WHATSAPP_TRANSCRIPTION_PROVIDER ?? 'none'
export const TRANSCRIPTION_MODEL = process.env.WHATSAPP_TRANSCRIPTION_MODEL

export const TRANSCRIPTION_PROVIDERS: Record<string, { url: string; keyEnv: string; defaultModel: string }> = {
  groq: {
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    keyEnv: 'GROQ_API_KEY',
    defaultModel: 'whisper-large-v3-turbo',
  },
  openai: {
    url: 'https://api.openai.com/v1/audio/transcriptions',
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'whisper-1',
  },
}
