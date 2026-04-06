# claude-whatsapp-channel

> WhatsApp channel for [Claude Code](https://code.claude.com) — message Claude from your phone, get replies back, approve tool use remotely.

Built on [Baileys](https://github.com/whiskeysockets/Baileys) (WhatsApp Web multi-device API). Mirrors the architecture of the [official Telegram and Discord channels](https://github.com/anthropics/claude-plugins-official).

---

## ⚠️ Important disclaimer

This plugin uses an **unofficial** WhatsApp client library (Baileys). Using unofficial clients may violate [Meta's Terms of Service](https://www.whatsapp.com/legal/terms-of-service). Account bans are possible. Use this plugin:

- Only with your own personal WhatsApp account
- At low volume (personal assistant use, not bulk messaging)
- At your own risk

For production business use, consider the official [WhatsApp Business Cloud API](https://developers.facebook.com/docs/whatsapp/cloud-api/) instead.

---

## Features

- **QR code linking** — scan once, session persists across Claude Code restarts
- **Pairing code** — headless linking without scanning (set `WHATSAPP_PHONE`)
- **Access control** — allowlist with pairing codes, same as official Telegram channel
- **Group support** — mention-triggered delivery in group chats
- **Media handling** — images auto-downloaded, other attachments on demand
- **Full tool set** — `reply`, `react`, `edit_message`, `download_attachment`
- **Auto-reconnect** — exponential backoff on disconnects
- **Rate limiting** — built-in delays between message chunks

---

## Prerequisites

- [Node.js](https://nodejs.org) v22+ (required for Baileys WebSocket support)
- [Bun](https://bun.sh) v1.0+ (required for the plugin system install path only)
- Claude Code v2.1.80+
- A WhatsApp account (personal phone number)

---

## Installation

### Recommended — plugin system

Inside a Claude Code session:

```
/plugin marketplace add mgiovani/claude-whatsapp-channel
/plugin install whatsapp@mgiovani-claude-whatsapp-channel
```

Then start Claude with the channel active:

```bash
claude --dangerously-load-development-channels plugin:whatsapp@whatsapp-channel
```

> **Why the flag?** Channels are in research preview with an Anthropic-curated allowlist. Community plugins aren't on it, so this flag is required. `--channels` will show the channel as "listening" but messages won't arrive. `allowedChannelPlugins` is a managed-only setting (Team/Enterprise MDM only) — there's no user-level workaround.

### Manual fallback — settings.json

If you prefer to manage the installation yourself:

```bash
git clone https://github.com/mgiovani/claude-whatsapp-channel
cd claude-whatsapp-channel
npm install
```

Then add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "whatsapp": {
      "command": "node",
      "args": ["--experimental-strip-types", "/absolute/path/to/claude-whatsapp-channel/server.ts"]
    }
  }
}
```

### Development — dangerously-load-development-channels

```bash
git clone https://github.com/mgiovani/claude-whatsapp-channel
cd claude-whatsapp-channel
npm install
claude --dangerously-load-development-channels server:whatsapp
```

---

## Setup

### Step 1 — Link your WhatsApp account

Start Claude with the channel active (use whichever matches your install):

```bash
# Plugin system install
claude --dangerously-load-development-channels plugin:whatsapp@whatsapp-channel

# Development install (local checkout)
claude --dangerously-load-development-channels server:whatsapp
```

Then in Claude, run:

```
/whatsapp:configure qr
```

This displays a QR code in your terminal. Scan it with WhatsApp:
- **iOS**: WhatsApp → Settings → Linked Devices → Link a Device
- **Android**: WhatsApp → ⋮ → Linked Devices → Link a Device

The session is saved to `~/.claude/channels/whatsapp/auth/` and persists across restarts.

### Step 1 (alternative) — Pairing code

If you can't scan a QR (headless server, remote setup):

```
/whatsapp:configure pair +5511999999999
```

Then restart Claude. When the channel starts, it requests a pairing code automatically. Run `/whatsapp:configure` to see it, then enter it on WhatsApp under **Linked Devices → Link a Device → Link with phone number instead**.

### Step 2 — Pair your phone number

From your phone, send **any message** to your own linked WhatsApp number (or to any WhatsApp from another number you want to authorize).

The channel replies with:
```
Pairing required — run in Claude Code:

/whatsapp:access pair a3f9b2
```

In Claude Code, run:
```
/whatsapp:access pair a3f9b2
```

You'll receive "Paired! Say hi to Claude." on WhatsApp within ~5 seconds.

### Step 3 — Lock it down (recommended)

Once your trusted numbers are paired, switch to `allowlist` mode so no new numbers can pair:

```
/whatsapp:access policy allowlist
```

---

## Usage

Once configured, start Claude Code with the channel active:

```bash
# Plugin system install
claude --dangerously-load-development-channels plugin:whatsapp@whatsapp-channel

# Development install (local checkout)
claude --dangerously-load-development-channels server:whatsapp
```

Send a WhatsApp message from a paired number. Claude receives it as:

```xml
<channel source="whatsapp" chat_id="5511999999999@s.whatsapp.net"
         message_id="3EB0..." user="John" ts="2026-03-23T11:00:00Z">
Hey Claude, what's the status of the deploy?
</channel>
```

Claude uses the **reply tool** to respond — messages go directly to WhatsApp.

---

## Tools

| Tool | Description |
|------|-------------|
| `reply(chat_id, text, reply_to?, files?)` | Send text with optional quote-reply and file attachments |
| `react(chat_id, message_id, emoji)` | Add emoji reaction to a message |
| `edit_message(chat_id, message_id, text)` | Edit a previously sent message (no push notification) |
| `download_attachment(message_id)` | Download media attachment to local inbox, returns file path |

---

## Access control

All state lives in `~/.claude/channels/whatsapp/access.json`:

```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["5511999999999@s.whatsapp.net"],
  "groups": {
    "120363xxxxxxxxx@g.us": { "requireMention": true, "allowFrom": [] }
  },
  "pending": {},
  "ackReaction": "👀",
  "textChunkLimit": 4096,
  "chunkMode": "length",
  "replyToMode": "first",
  "documentThreshold": 4000,
  "documentFormat": "auto"
}
```

### Skills

| Command | Description |
|---------|-------------|
| `/whatsapp:configure` | Check connection status and access policy |
| `/whatsapp:configure qr` | Display QR code to link your phone |
| `/whatsapp:configure pair <phone>` | Set phone for pairing code flow |
| `/whatsapp:configure logout` | Unlink the device and clear auth |
| `/whatsapp:access` | Show current access state |
| `/whatsapp:access pair <code>` | Approve a pairing request |
| `/whatsapp:access deny <code>` | Deny a pairing request |
| `/whatsapp:access allow <jid>` | Add a JID to the allowlist directly |
| `/whatsapp:access remove <jid>` | Remove a JID from the allowlist |
| `/whatsapp:access policy <mode>` | Set DM policy: `pairing`, `allowlist`, or `disabled` |
| `/whatsapp:access group add <groupJid>` | Enable a group (mention-gated by default; `--no-mention` to skip; `--allow jid1,jid2` to restrict senders) |
| `/whatsapp:access group rm <groupJid>` | Disable a group |

### Group support

To allow a group chat, add it to the access config:

```
/whatsapp:access group add 120363xxxxxxxxx@g.us
```

By default, only messages that @mention your linked number (or reply to Claude's messages) are delivered. To disable the mention requirement:

```
/whatsapp:access group add 120363xxxxxxxxx@g.us --no-mention
```

---

## Configuration

Optional settings in `access.json` (set via `/whatsapp:access set`):

| Key | Default | Description |
|-----|---------|-------------|
| `ackReaction` | (none) | Emoji to react with on receipt (e.g. `"👀"`) |
| `textChunkLimit` | `4096` | Max chars per message before splitting |
| `chunkMode` | `length` | `length` (hard split) or `newline` (paragraph split) |
| `replyToMode` | `first` | Which chunks get a quote-reply: `off`, `first`, `all` |
| `mentionPatterns` | `[]` | Extra regex patterns for group mention detection |
| `documentThreshold` | `4000` | Char length above which replies are sent as a file attachment (`0` = disabled, `-1` = always) |
| `documentFormat` | `auto` | File format for document replies: `auto`, `md`, or `txt` |

---

## How it works

```
WhatsApp (your phone)
    ↕ (WhatsApp Web multi-device protocol)
Baileys WebSocket (in server.ts)
    ↕ (stdio MCP protocol)
Claude Code session
```

The plugin is an MCP server (`server.ts` + `lib.ts`) that:
1. Maintains a Baileys WebSocket connection to WhatsApp
2. Pushes incoming messages into Claude Code via `notifications/claude/channel`
3. Exposes tools (reply, react, etc.) that Claude calls to send responses

State files in `~/.claude/channels/whatsapp/`:
- `auth/` — Baileys session (multi-file auth state)
- `access.json` — access control (managed by `/whatsapp:access`)
- `.env` — optional config (`WHATSAPP_PHONE`)
- `inbox/` — downloaded media files
- `approved/` — approval signals from the access skill to the server
- `qr.txt` — current QR code (transient, removed on connect)
- `state.json` — connection state (status, linked JID, pairing code)
- `server.pid` — lock file (prevents duplicate sessions)

---

## Future providers

The architecture is designed to support additional WhatsApp providers:

- **whatsmeow** (Go) — production-grade, powers mautrix-whatsapp bridge
- **WhatsApp Business Cloud API** (official) — zero ban risk, for business accounts

---

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup, testing, and PR guidelines.

---

## License

Apache 2.0 — see [LICENSE](LICENSE).

This project is not affiliated with or endorsed by WhatsApp or Meta.
