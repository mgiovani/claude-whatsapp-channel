#!/usr/bin/env node --experimental-strip-types
// Renders the WhatsApp QR code as a PNG image for scanning. Used by /whatsapp:configure skill.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import QRCode from 'qrcode'

const STATE_DIR = join(homedir(), '.claude', 'channels', 'whatsapp')
const QR_FILE = join(STATE_DIR, 'qr.txt')
const QR_IMAGE = join(STATE_DIR, 'qr.png')

if (!existsSync(QR_FILE)) {
  console.log('NO_QR: No QR code available.')
  console.log('The server may not be running, or it\'s already connected.')
  console.log('Check status with: /whatsapp:configure')
  process.exit(0)
}

const qrData = readFileSync(QR_FILE, 'utf8').trim()
if (!qrData) {
  console.log('NO_QR: QR file is empty.')
  process.exit(0)
}

const qrArt = await QRCode.toString(qrData, { type: 'utf8', margin: 2 })
console.log('')
console.log(qrArt)

await QRCode.toFile(QR_IMAGE, qrData, { width: 600, margin: 2 })

console.log(`QR_IMAGE: ${QR_IMAGE}`)
console.log('')
console.log('--- Scan instructions ---')
console.log('Open WhatsApp on your phone:')
console.log('  iOS:     Settings > Linked Devices > Link a Device')
console.log('  Android: More options > Linked Devices > Link a Device')
console.log('')
console.log('Then point your camera at the QR code above.')
console.log('')
console.log('Note: This is an unofficial integration — use at your own risk.')
console.log('QR codes rotate every ~20s. Run /whatsapp:configure qr for a fresh one if needed.')
