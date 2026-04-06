---
name: configure
description: Set up the WhatsApp channel — authenticate via QR code or pairing code, and review access policy. Use when the user wants to connect WhatsApp, asks to configure it, says "how do I set this up", or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(bash *)
  - Bash(node *)
  - Bash(mkdir *)
  - Bash(chmod *)
---

# /whatsapp:configure — WhatsApp Channel Setup

Unlike Telegram (which uses a bot token), WhatsApp requires linking a phone number
via QR code or a pairing code. Auth state persists in
`~/.claude/channels/whatsapp/auth/` between sessions.

> **Note:** This is an **unofficial, community-built** WhatsApp integration. It uses
> the Baileys library (reverse-engineered WhatsApp Web protocol), which is not endorsed
> by WhatsApp/Meta. Use at your own risk — WhatsApp may ban or restrict accounts that
> use unofficial clients. Be mindful of WhatsApp's Terms of Service.

Arguments passed: `$ARGUMENTS`

All subcommands are handled by a single script. Resolve the script path once:

```bash
SCRIPT="${CLAUDE_PLUGIN_ROOT:-$(dirname "$(find ~/.claude -name configure.ts -path '*/whatsapp*/scripts/*' 2>/dev/null | head -1)" 2>/dev/null | sed 's|/scripts$||')}/scripts/configure.ts"
```

If the script doesn't exist, tell the user the plugin may not be installed correctly.

---

## Dispatch on arguments

### No args — show status and auto-display QR if awaiting

```bash
node --experimental-strip-types "$SCRIPT"
```

Present the output to the user in a readable format. The output has structured
lines like `CONNECTION: awaiting_qr`, `DM_POLICY: pairing`, `ALLOWED_COUNT: 1`,
`PAIRING_CODE: ABCD1234`, etc.

**If the output contains `PAIRING_CODE:` (not `none`)**, display the code prominently
and give instructions — do NOT run the QR script:

> **Your pairing code: `ABCD-1234`**
>
> On WhatsApp, go to:
> **Linked Devices → Link a Device → Link with phone number instead**
> Enter the 8-digit code above.
>
> The script is waiting and will detect the connection automatically.

**If the output contains `CONNECTION: awaiting_qr`** (and no pairing code), also run
the QR subcommand immediately so the user can scan without a second command:

```bash
node --experimental-strip-types "$SCRIPT" qr
```

**What next** — end with a concrete next step based on the status:
- `awaiting_qr` with pairing code → show code as above (do not show QR)
- `awaiting_qr` without pairing code → *"Press **Ctrl+O** (Cmd+O on Mac) on the Bash
  output above to expand the QR code, then scan it with WhatsApp
  (Linked Devices → Link a Device). If it expired, run `/whatsapp:configure qr`
  for a fresh one. Or run `/whatsapp:configure pair +5511999999999` to use a
  pairing code instead."*
- `disconnected:*` or `logged_out` → *"Restart the channel server, then run
  `/whatsapp:configure` again."*
- `connected`, nobody allowed → *"Send a WhatsApp message from your phone. The channel
  replies with a 6-char code; approve with `/whatsapp:access pair <code>`."*
- `connected`, someone allowed → *"Ready. Send a WhatsApp message from an approved
  number to reach Claude."*

**Push toward lockdown — always.** Once trusted numbers are in the allowlist, suggest
switching `dmPolicy` to `allowlist` so no new numbers can trigger pairing codes.

### `qr` — display QR code

```bash
node --experimental-strip-types "$SCRIPT" qr
```

The script prints the QR code as UTF-8 block art, then **polls for up to 60s**,
auto-refreshing the QR when it rotates. It prints `CONNECTED: <jid>` on success
or `TIMEOUT:` if no connection after 60s.

**Do NOT try to re-render or copy the QR code.** Instead, tell the user:

> Press **Ctrl+O** (or **Cmd+O** on Mac) on the Bash output above to expand the full
> QR code, then scan it with WhatsApp (Linked Devices > Link a Device).
> The script auto-refreshes the QR and will detect the connection automatically.

If the output contains `CONNECTED:`, confirm success. If `TIMEOUT:`, suggest retrying.

### `pair <phone>` — pairing code flow

Pairing code is an alternative to QR scanning — useful for headless setups.

1. Treat `$ARGUMENTS` after `pair` as the phone number.
   Example: `pair +55 11 99999-9999`

```bash
node --experimental-strip-types "$SCRIPT" pair "<raw phone argument>"
```

The script saves the phone, waits for the pairing code, then **polls for up to 60s**
for the connection to complete. It auto-refreshes codes when they rotate.

2. If the output contains `PAIRING_CODE_READY:`, display it prominently:

> **Your pairing code: `XXXX-XXXX`**
>
> On WhatsApp, go to:
> **Linked Devices → Link a Device → Link with phone number instead**
> Enter the 8-digit code above.

3. If `CONNECTED:` appears, confirm success.
4. If `PAIRING_CODE_REFRESHED:`, show the new code (the old one expired).
5. If `TIMEOUT:`, suggest the user retry with `/whatsapp:configure pair <phone>`.

### `logout` — unlink the device

```bash
node --experimental-strip-types "$SCRIPT" logout
```

Present the script's output to the user.

### `clear` — remove phone from state

```bash
node --experimental-strip-types "$SCRIPT" clear
```

### `transcription <provider>` — configure voice message transcription

Automatically transcribes inbound voice messages and prepends the text to Claude's
notification. Claude sees the transcript immediately without calling `download_attachment`.

**Available providers:**

| Provider | Key required | Default model | Notes |
|---|---|---|---|
| `groq` | `GROQ_API_KEY` | `whisper-large-v3-turbo` | Fast, generous free tier — recommended |
| `openai` | `OPENAI_API_KEY` | `whisper-1` | OpenAI hosted Whisper |
| `none` | — | — | Disable transcription (default) |

**Steps:**

1. Parse `$ARGUMENTS` after `transcription` as `<provider>` and optionally `<api-key>`.
   Example: `transcription groq gsk_abc123` → provider=`groq`, key=`gsk_abc123`
   Example: `transcription openai` → provider=`openai`, no key supplied
   Example: `transcription none` → disable transcription
2. `mkdir -p ~/.claude/channels/whatsapp`
3. Read existing `.env` if present. Update or add:
   - `WHATSAPP_TRANSCRIPTION_PROVIDER=<provider>`
   - If an API key was provided: add/update the appropriate key line
     (`GROQ_API_KEY=...` or `OPENAI_API_KEY=...`)
   - Preserve all other existing lines.
4. Write back, no quotes around values. `chmod 600 ~/.claude/channels/whatsapp/.env`
5. If provider is `none`: tell the user transcription is disabled (default behavior restored).
6. If a remote provider was set: tell the user transcription is enabled and note that a
   server restart or `/reload-plugins` is required for changes to take effect.

**Optional model override:** Users can also manually add
`WHATSAPP_TRANSCRIPTION_MODEL=whisper-large-v3` to `.env` to override the default model.

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing = not configured.
- Phone number is stored in `state.json` (not `.env`). The server polls for it every 3s.
- `access.json` is re-read on every inbound message — policy changes take effect immediately.
- QR codes expire quickly (~60s for first, ~20s for subsequent). If scanning fails, re-run
  `/whatsapp:configure qr` to get the next QR.
- WhatsApp limits linked devices to 4. If the user has 4 already, they'll need to unlink
  one first from their phone.
