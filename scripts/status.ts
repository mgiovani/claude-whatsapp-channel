#!/usr/bin/env node --experimental-strip-types
// Prints WhatsApp channel status summary. Used by /whatsapp:configure skill.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'whatsapp')

// --- Connection (from state.json) ---
let status = 'not_started'
let myJid = ''
let pairingCode = ''

const stateFile = join(STATE_DIR, 'state.json')
if (existsSync(stateFile)) {
  try {
    const s = JSON.parse(readFileSync(stateFile, 'utf8'))
    status = s.status ?? 'not_started'
    myJid = s.myJid ?? ''
    pairingCode = s.pairingCode ?? ''
  } catch {}
}

console.log(`CONNECTION: ${status}`)
if (myJid) {
  const phone = myJid.replace(/[@:].*$/, '')
  console.log(`LINKED_NUMBER: ${phone}`)
}
if (pairingCode) {
  console.log(`PAIRING_CODE: ${pairingCode}`)
} else {
  console.log('PAIRING_CODE: none')
}

// --- Access ---
const accessFile = join(STATE_DIR, 'access.json')
if (existsSync(accessFile)) {
  try {
    const a = JSON.parse(readFileSync(accessFile, 'utf8'))

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
  console.log('DM_POLICY: pairing (default — no access.json yet)')
  console.log('ALLOWED_COUNT: 0')
  console.log('PENDING_COUNT: 0')
  console.log('GROUPS_COUNT: 0')
}

// --- Phone config ---
const envFile = join(STATE_DIR, '.env')
if (existsSync(envFile)) {
  try {
    const content = readFileSync(envFile, 'utf8')
    const match = content.match(/^WHATSAPP_PHONE=(.+)$/m)
    if (match) {
      console.log(`PAIRING_PHONE: ${match[1]}`)
    } else {
      console.log('PAIRING_PHONE: none')
    }
  } catch {
    console.log('PAIRING_PHONE: none')
  }
} else {
  console.log('PAIRING_PHONE: none')
}
