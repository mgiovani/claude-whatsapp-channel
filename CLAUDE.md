# claude-whatsapp-channel

WhatsApp channel plugin for Claude Code, built with Baileys.

## Stack

- **Runtime**: Node.js (Baileys requires full `ws` WebSocket support — Bun lacks `upgrade`/`unexpected-response` events)
- **Language**: TypeScript (`--experimental-strip-types`, no build step)
- **WhatsApp**: `@whiskeysockets/baileys` v7 (WhatsApp Web multi-device)
- **MCP**: `@modelcontextprotocol/sdk`
- **Architecture**: Mirrors the official `telegram` and `discord` channels from `anthropics/claude-plugins-official`

## Project structure

```
server.ts                  MCP server (~1250 lines) — WhatsApp connection, MCP tools, message routing
lib.ts                     Pure functions: access control, JID helpers, message parsing (~425 lines)
lib.test.ts                Unit tests for lib.ts (bun:test)
skills/configure/SKILL.md  /whatsapp:configure skill
skills/access/SKILL.md     /whatsapp:access skill
scripts/                   Shell helpers: logout.sh, show-qr.sh, status.sh
.claude-plugin/plugin.json Plugin metadata
.mcp.json                  MCP server config (node, uses ${CLAUDE_PLUGIN_ROOT})
```

## Development

```bash
npm install

# Plugin install (recommended — loads skills automatically):
# Inside Claude Code: /plugin install whatsapp@https://github.com/mgiovani/claude-whatsapp-channel

# Dev mode (local checkout):
claude --dangerously-load-development-channels server:whatsapp

# Manual MCP registration (settings.json):
# "node", ["--experimental-strip-types", "/abs/path/to/server.ts"]
```

Note: `.mcp.json` uses `${CLAUDE_PLUGIN_ROOT}` which is only resolved by the plugin system. For dev mode, use `--dangerously-load-development-channels` or the manual settings.json path.

## State directory

All runtime state lives in `~/.claude/channels/whatsapp/`:

```
auth/            Baileys session files (multi-file auth state)
access.json      Access control (allowlist, pending pairings, groups)
.env             Optional config (WHATSAPP_PHONE for pairing code flow)
inbox/           Downloaded media files
approved/        Signals from /whatsapp:access pair to the running server
qr.txt           Current QR code string (transient)
state.json       Connection state (status, linked JID, pairing code)
server.pid       Lock file (prevents duplicate sessions)
```

## Key design decisions

- **Two-file structure**: `server.ts` handles the MCP server and WhatsApp connection; `lib.ts` holds pure functions (access control, JID helpers, message parsing, formatting). No `src/` dir or build pipeline. Matches the official plugin pattern.
- **Baileys v7**: The only TypeScript/Bun-native WhatsApp library. Uses WhatsApp's multi-device WebSocket protocol.
- **Access control**: Identical pattern to the official Telegram channel. JIDs replace numeric Telegram IDs.
- **Media**: Images auto-downloaded inline (like Telegram photos). Other media listed in notification meta; Claude calls `download_attachment` on demand.
- **Edit support**: Sent message keys are stored in memory (capped at 200). WhatsApp requires the original `WAMessageKey` to edit.
- **Rate limiting**: 500ms delay between text chunks to avoid WhatsApp's automation detection.
- **No static mode**: Unlike Telegram, WhatsApp doesn't support static/snapshot access because the WebSocket connection is stateful.

## Adding providers (future)

The gate/access/MCP layers are provider-agnostic. To add whatsmeow or the official Cloud API:

1. Extract the `connectWhatsApp()` function into a provider interface
2. Add a `WHATSAPP_PROVIDER=baileys|whatsmeow|cloud-api` env var
3. Implement the provider behind the same event interface (`messages.upsert`, `sendMessage`, etc.)

## Testing

```bash
# 1. Start Claude with this channel
claude --dangerously-load-development-channels server:whatsapp

# 2. In Claude, configure and link
/whatsapp:configure qr    # Shows QR code
                          # Scan with WhatsApp app

# 3. Send a test message from another WhatsApp number
# → Channel sends pairing code

# 4. Approve pairing
/whatsapp:access pair <code>

# 5. Send a message → verify Claude receives it and can reply
```

## Reference implementations

The architecture mirrors the official Anthropic channel plugins:
- [Telegram channel](https://github.com/anthropics/claude-plugins-official) — primary template (access control, pairing, message routing)
- [Discord channel](https://github.com/anthropics/claude-plugins-official) — download_attachment pattern
- [Fakechat](https://github.com/anthropics/claude-plugins-official) — minimal MCP channel reference
