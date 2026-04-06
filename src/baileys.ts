/**
 * CJS/ESM interop for @whiskeysockets/baileys.
 * Node.js wraps CJS modules — default export is makeWASocket,
 * named exports are available on the namespace object.
 * Import from here instead of repeating the interop boilerplate.
 */

import * as _baileys from '@whiskeysockets/baileys'

export const makeWASocket = (_baileys as any).default as typeof _baileys.default
export const {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  makeCacheableSignalKeyStore,
} = _baileys

export type WASocket = ReturnType<typeof makeWASocket>
