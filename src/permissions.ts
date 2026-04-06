/**
 * Permission relay: forward tool approval prompts to allowlisted WhatsApp contacts.
 * Supports both emoji reactions and text verdicts ("yes <id>" / "no <id>").
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { PermissionRequestSchema } from './types.ts'
import {
  APPROVE_EMOJI,
  DENY_EMOJI,
  PERMISSION_TTL_MS,
} from './constants.ts'
import {
  getSock,
  waitForConnection,
  lidToPhone,
} from './connection.ts'
import { loadAccess } from './access.ts'

// ─── Pending permission requests ──────────────────────────────────────────────
// Track outbound permission request messages so we can correlate emoji reactions
// (✅/❌) back to the original request_id. Entries auto-expire after 5 minutes.

export const pendingPermissions = new Map<string, { request_id: string; timer: ReturnType<typeof setTimeout> }>()

// ─── Permission preview formatter ─────────────────────────────────────────────

export function formatPermissionPreview(tool_name: string, input_preview: string): string {
  let input: Record<string, unknown>
  try {
    input = JSON.parse(input_preview) as Record<string, unknown>
  } catch {
    const raw = input_preview.length > 400 ? input_preview.slice(0, 400) + '…' : input_preview
    return `\`\`\`\n${raw}\n\`\`\``
  }

  const str = (v: unknown, max = 250): string => {
    const s = String(v ?? '').trim()
    return s.length > max ? s.slice(0, max) + '…' : s
  }

  switch (tool_name) {
    case 'Edit': {
      const file = str(input.file_path).split('/').pop() ?? str(input.file_path)
      const oldStr = str(input.old_string, 200)
      const newStr = str(input.new_string, 200)
      return `📄 *${file}*\n\n*Before:*\n\`\`\`\n${oldStr}\n\`\`\`\n*After:*\n\`\`\`\n${newStr}\n\`\`\``
    }
    case 'Write': {
      const file = str(input.file_path).split('/').pop() ?? str(input.file_path)
      const content = str(input.content, 200)
      return `📄 *${file}*\n\`\`\`\n${content}\n\`\`\``
    }
    case 'Bash': {
      const cmd = str(input.command, 400)
      return `\`\`\`\n$ ${cmd}\n\`\`\``
    }
    case 'Read': {
      return `📖 ${str(input.file_path)}`
    }
    case 'Grep': {
      const path = input.path ? ` in ${str(input.path)}` : ''
      return `🔍 \`${str(input.pattern)}\`${path}`
    }
    case 'Glob': {
      const path = input.path ? ` in ${str(input.path)}` : ''
      return `🔍 \`${str(input.pattern)}\`${path}`
    }
    default: {
      const raw = input_preview.length > 400 ? input_preview.slice(0, 400) + '…' : input_preview
      return `\`\`\`\n${raw}\n\`\`\``
    }
  }
}

// ─── Emoji reaction handler ───────────────────────────────────────────────────
// Called from connection.ts via the onReaction hook.

export function handleReaction(reactions: any[], mcp: Server): void {
  for (const { key, reaction } of reactions) {
    const msgId = key.id
    if (!msgId) continue
    const pending = pendingPermissions.get(msgId)
    if (!pending) continue

    const emoji = reaction.text || ''
    let behavior: 'allow' | 'deny' | null = null
    if (APPROVE_EMOJI.has(emoji)) behavior = 'allow'
    else if (DENY_EMOJI.has(emoji)) behavior = 'deny'
    if (!behavior) continue

    void mcp.notification({
      method: 'notifications/claude/channel/permission',
      params: { request_id: pending.request_id, behavior },
    }).catch(err => process.stderr.write(`whatsapp channel: reaction verdict failed: ${err}\n`))

    clearTimeout(pending.timer)
    pendingPermissions.delete(msgId)
  }
}

// ─── Permission relay notification handler ────────────────────────────────────
// Declared in capabilities.experimental['claude/channel/permission'].
// When Claude wants to run a tool, Claude Code sends a permission_request
// notification here. We forward it to all allowlisted DM contacts.

export function registerPermissionHandlers(mcp: Server): void {
  mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
    const sock = getSock()
    try {
      await waitForConnection(3000)
      const access = loadAccess()
      const targets = access.allowFrom.filter(jid => jid.endsWith('@s.whatsapp.net'))
      if (targets.length === 0) return

      const preview = formatPermissionPreview(params.tool_name, params.input_preview)
      const text =
        `🔐 *Permission Request*\n\n` +
        `Claude wants to run *${params.tool_name}*\n` +
        `${params.description}\n\n` +
        `${preview}\n\n` +
        `React 👍 to approve or 👎 to deny\n` +
        `_or reply *yes ${params.request_id}* / *no ${params.request_id}*_`

      for (const jid of targets) {
        const sent = await sock!.sendMessage(jid, { text })
        const sentId = sent?.key?.id
        if (sentId) {
          const timer = setTimeout(() => pendingPermissions.delete(sentId), PERMISSION_TTL_MS)
          pendingPermissions.set(sentId, { request_id: params.request_id, timer })
        }
      }
    } catch (err) {
      process.stderr.write(`whatsapp channel: permission relay failed: ${err}\n`)
    }
  })
}
