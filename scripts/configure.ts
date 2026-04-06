#!/usr/bin/env node --experimental-strip-types
// Unified configure script for /whatsapp:configure skill.
// Subcommands: status (default), qr, pair <phone>, logout, clear

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { homedir, platform } from 'os'
import { execSync, spawn } from 'child_process'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'whatsapp')
const STATE_FILE = join(STATE_DIR, 'state.json')
const ACCESS_FILE = join(STATE_DIR, 'access.json')
const QR_FILE = join(STATE_DIR, 'qr.txt')
const QR_IMAGE = join(STATE_DIR, 'qr.png')
const ENV_FILE = join(STATE_DIR, '.env')

const [subcommand, ...rest] = process.argv.slice(2)

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadState(): Record<string, unknown> {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return {} }
}

function saveState(state: Record<string, unknown>): void {
  mkdirSync(STATE_DIR, { recursive: true })
  const tmp = STATE_FILE + '.tmp'
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  writeFileSync(STATE_FILE, readFileSync(tmp, 'utf8'))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const POLL_INTERVAL = 2000
const POLL_TIMEOUT = 120_000

const isWSL = platform() === 'linux' && existsSync('/proc/version')
  && readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft')

function openImage(filePath: string): void {
  const cmd = platform() === 'darwin' ? 'open' : isWSL ? 'wslview' : 'xdg-open'
  try {
    spawn(cmd, [filePath], { detached: true, stdio: 'ignore' }).unref()
  } catch {}
}

// ─── Subcommands ─────────────────────────────────────────────────────────────

async function status(): Promise<void> {
  // Connection
  const state = loadState()
  const connStatus = (state.status as string) ?? 'not_started'
  const myJid = (state.myJid as string) ?? ''
  const pairingCode = (state.pairingCode as string) ?? ''

  console.log(`CONNECTION: ${connStatus}`)
  if (myJid) {
    console.log(`LINKED_NUMBER: ${myJid.replace(/[@:].*$/, '')}`)
  }
  console.log(`PAIRING_CODE: ${pairingCode || 'none'}`)

  // Access
  if (existsSync(ACCESS_FILE)) {
    try {
      const a = JSON.parse(readFileSync(ACCESS_FILE, 'utf8'))
      console.log(`DM_POLICY: ${a.dmPolicy ?? 'pairing'}`)
      const allow: string[] = a.allowFrom ?? []
      console.log(`ALLOWED_COUNT: ${allow.length}`)
      for (const jid of allow) console.log(`  ALLOWED: ${jid}`)
      const pending: Record<string, { senderId?: string }> = a.pending ?? {}
      const pendingEntries = Object.entries(pending)
      console.log(`PENDING_COUNT: ${pendingEntries.length}`)
      for (const [code, p] of pendingEntries) console.log(`  PENDING: ${code} from ${p.senderId ?? '?'}`)
      const groups: Record<string, unknown> = a.groups ?? {}
      const groupIds = Object.keys(groups)
      console.log(`GROUPS_COUNT: ${groupIds.length}`)
      for (const gid of groupIds) console.log(`  GROUP: ${gid}`)
    } catch {
      console.log('ACCESS_ERROR: cannot parse access.json')
    }
  } else {
    console.log('DM_POLICY: pairing (default)')
    console.log('ALLOWED_COUNT: 0')
    console.log('PENDING_COUNT: 0')
    console.log('GROUPS_COUNT: 0')
  }

  // Phone
  let phone = (state.phone as string) ?? ''
  if (!phone) {
    try {
      const content = readFileSync(ENV_FILE, 'utf8')
      const match = content.match(/^WHATSAPP_PHONE=(.+)$/m)
      if (match) phone = match[1]
    } catch {}
  }
  console.log(`PAIRING_PHONE: ${phone || 'none'}`)

  // Auto-display QR when awaiting and no pairing code active
  if (connStatus === 'awaiting_qr' && !pairingCode) {
    console.log('')
    await qr()
  }
}

async function renderQr(QRCode: typeof import('qrcode').default): Promise<string> {
  if (!existsSync(QR_FILE)) return ''
  const qrData = readFileSync(QR_FILE, 'utf8').trim()
  if (!qrData) return ''
  const qrArt = await QRCode.toString(qrData, { type: 'utf8', margin: 2 })
  await QRCode.toFile(QR_IMAGE, qrData, { width: 600, margin: 2 })
  return qrArt
}

const QR_TMP = '/tmp/whatsapp-qr.txt'

async function qr(): Promise<void> {
  const QRCode = (await import('qrcode')).default
  const qrArt = await renderQr(QRCode)

  if (!qrArt) {
    console.log('NO_QR: No QR code available.')
    console.log('The server may not be running, or it\'s already connected.')
    console.log('Check status with: /whatsapp:configure')
    return
  }

  writeFileSync(QR_TMP, qrArt)
  openImage(QR_IMAGE)
  console.log('')
  console.log(qrArt)
  console.log(`QR_TEXT: ${QR_TMP}`)
  console.log(`QR_IMAGE: ${QR_IMAGE}`)
  console.log('')
  console.log('━━ Scan with WhatsApp > Linked Devices > Link a Device ━━')
  console.log('')
  console.log('QR expires in ~60s. Run /whatsapp:configure qr for a fresh one.')
  console.log('Run /whatsapp:configure to check connection status.')
}

async function pair(phoneArg: string): Promise<void> {
  const phone = phoneArg.replace(/\D/g, '')
  if (phone.length < 8) {
    console.log('ERROR: Phone number too short (need at least 8 digits).')
    process.exit(1)
  }

  const state = loadState()
  state.phone = phone
  delete state.pairingCode
  saveState(state)

  console.log(`PHONE_SET: ${phone}`)
  console.log('Waiting for pairing code...')

  let lastCode = ''
  const deadline = Date.now() + POLL_TIMEOUT

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL)
    const updated = loadState()

    if ((updated.status as string) === 'connected') {
      const jid = (updated.myJid as string) ?? ''
      console.log(`\nCONNECTED: ${jid}`)
      console.log('Run /whatsapp:configure to check status and manage access.')
      return
    }

    const code = (updated.pairingCode as string) ?? ''
    if (code && code !== lastCode) {
      if (!lastCode) {
        console.log(`PAIRING_CODE_READY: ${code}`)
        console.log('On WhatsApp: Linked Devices > Link a Device > Link with phone number instead')
        console.log('Waiting for connection...')
      } else {
        console.log(`PAIRING_CODE_REFRESHED: ${code}`)
      }
      lastCode = code
    }
  }

  console.log('\nTIMEOUT: No connection after 2 minutes.')
  console.log('Run /whatsapp:configure pair <phone> to try again.')
}

async function logout(): Promise<void> {
  const scriptDir = import.meta.dirname ?? join(import.meta.url.replace('file://', ''), '..')
  try {
    execSync(`bash "${join(scriptDir, 'logout.sh')}"`, { stdio: 'inherit' })
  } catch {
    console.log('ERROR: logout.sh failed')
  }
}

async function clear(): Promise<void> {
  const state = loadState()
  delete state.phone
  delete state.pairingCode
  saveState(state)

  // Migration cleanup: remove WHATSAPP_PHONE from .env if present
  if (existsSync(ENV_FILE)) {
    try {
      const content = readFileSync(ENV_FILE, 'utf8')
      const cleaned = content.replace(/^WHATSAPP_PHONE=.*\n?/m, '')
      if (cleaned.trim()) {
        writeFileSync(ENV_FILE, cleaned)
      } else {
        rmSync(ENV_FILE, { force: true })
      }
    } catch {}
  }

  console.log('PHONE_CLEARED: Phone number and pairing code removed.')
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

switch (subcommand) {
  case 'qr':
    await qr()
    break
  case 'pair': {
    const phoneArg = rest.join(' ')
    if (!phoneArg) {
      console.log('ERROR: No phone number provided.')
      console.log('Usage: /whatsapp:configure pair +5511999999999')
      process.exit(1)
    }
    await pair(phoneArg)
    break
  }
  case 'logout':
    await logout()
    break
  case 'clear':
    await clear()
    break
  default:
    await status()
    break
}
