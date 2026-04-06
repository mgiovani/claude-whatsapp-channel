/**
 * Security checks for outbound operations.
 */

import { realpathSync } from 'fs'
import { sep } from 'path'

// reply's files param takes any path. .env is a credential and the server's
// own state is the one thing Claude has no reason to ever send.
export function assertSendable(f: string, stateDir: string): void {
  let real, stateReal: string
  try {
    real = realpathSync(f)
    stateReal = realpathSync(stateDir)
  } catch { return }
  const inbox = stateReal + sep + 'inbox'
  if (real.startsWith(stateReal + sep) && !real.startsWith(inbox + sep)) {
    throw new Error(`refusing to send channel state: ${f}`)
  }
}
