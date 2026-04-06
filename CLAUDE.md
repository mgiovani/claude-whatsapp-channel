# claude-whatsapp-channel

WhatsApp channel plugin for Claude Code, built with Baileys.

## Stack

- **Runtime**: Node.js (Baileys requires full `ws` WebSocket support — Bun lacks `upgrade`/`unexpected-response` events)
- **Language**: TypeScript (single-file, `--experimental-strip-types`, no build step)
- **WhatsApp**: `@whiskeysockets/baileys` v7 (WhatsApp Web multi-device)
- **MCP**: `@modelcontextprotocol/sdk`
- **Architecture**: Mirrors the official `telegram` and `discord` channels from `anthropics/claude-plugins-official`

## Project structure

```
server.ts                  Single-file MCP server (~850 lines)
skills/configure/SKILL.md  /whatsapp:configure skill
skills/access/SKILL.md     /whatsapp:access skill
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
me.txt           Our linked JID (e.g. 5511999999999@s.whatsapp.net)
status.txt       Connection status (connected/awaiting_qr/logged_out/disconnected:*)
pairing_code.txt Pairing code from WhatsApp (transient, if using pairing code flow)
```

## Key design decisions

- **Single file**: `server.ts` is self-contained, no `src/` or build pipeline. Matches the official plugin pattern.
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

- Telegram channel (primary template): `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/server.ts`
- Discord channel (download_attachment pattern): `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/discord/server.ts`
- Fakechat (minimal reference): `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/fakechat/server.ts`
