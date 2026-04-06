#!/usr/bin/env node --experimental-strip-types
// Saves a phone number to state.json for pairing code flow. Used by /whatsapp:configure skill.

import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'whatsapp')
const STATE_FILE = join(STATE_DIR, 'state.json')

const raw = process.argv[2]
if (!raw) {
  console.log('ERROR: No phone number provided.')
  console.log('Usage: set-phone.ts <phone>')
  process.exit(1)
}

const phone = raw.replace(/\D/g, '')
if (phone.length < 8) {
  console.log('ERROR: Phone number too short (need at least 8 digits).')
  process.exit(1)
}

mkdirSync(STATE_DIR, { recursive: true })

let state: Record<string, unknown> = {}
try {
  state = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
} catch {}

state.phone = phone
// Clear any stale pairing code so the server generates a fresh one
delete state.pairingCode

const tmp = STATE_FILE + '.tmp'
writeFileSync(tmp, JSON.stringify(state, null, 2))
writeFileSync(STATE_FILE, readFileSync(tmp, 'utf8'))

console.log(`PHONE_SET: ${phone}`)
console.log('The server will generate a pairing code within a few seconds.')
console.log('Run /whatsapp:configure to see it.')
