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

All subcommands except `transcription` are handled by a single script.
Run it **in the foreground** (never in the background) with a **timeout of at least
150 seconds** (the script polls for up to 2 minutes):

```bash
node --experimental-strip-types "$CLAUDE_PLUGIN_ROOT/scripts/configure.ts" $ARGUMENTS
```

If `$CLAUDE_PLUGIN_ROOT` is not set, the plugin may not be installed correctly.

---

## Interpreting the output

### No args — show status and auto-display QR if awaiting

Present the output to the user in a readable format. The output has structured
lines like `CONNECTION: awaiting_qr`, `DM_POLICY: pairing`, `ALLOWED_COUNT: 1`,
`PAIRING_CODE: ABCD1234`, etc.

**If the output contains `PAIRING_CODE:` (not `none`)**, display the code prominently
and give instructions:

> **Your pairing code: `ABCD-1234`**
>
> On WhatsApp, go to:
> **Linked Devices → Link a Device → Link with phone number instead**
> Enter the 8-digit code above.
>
> The script is waiting and will detect the connection automatically.

**If the output contains `CONNECTION: awaiting_qr`** (and no pairing code), the script
automatically displays the QR code and polls for connection.

The script automatically opens the QR code image in the system's default image viewer
(`open` on macOS, `wslview` on WSL, `xdg-open` on Linux). It also saves the QR text
art to `/tmp/whatsapp-qr.txt`.

**After the script finishes**, if a QR was displayed, **Read `/tmp/whatsapp-qr.txt`**
and present it directly to the user. Then tell them:
- Scan the QR from the image viewer that opened
- Or press **Ctrl+O** (Cmd+O on Mac) on the Bash output above to expand the QR
- Or run `cat /tmp/whatsapp-qr.txt` in another terminal to see the full QR

**What next** — end with a concrete next step based on the status:
- `awaiting_qr` with pairing code → show code as above (do not show QR)
- `awaiting_qr` without pairing code → *"Scan the QR code, then run
  `/whatsapp:configure` to check the connection. If the QR expired, run
  `/whatsapp:configure qr` for a fresh one. Or run
  `/whatsapp:configure pair +5511999999999` to use a pairing code instead."*
- `disconnected:*` or `logged_out` → *"Restart the channel server, then run
  `/whatsapp:configure` again."*
- `connected`, nobody allowed → *"Send a WhatsApp message from your phone. The channel
  replies with a 6-char code; approve with `/whatsapp:access pair <code>`."*
- `connected`, someone allowed → *"Ready. Send a WhatsApp message from an approved
  number to reach Claude."*

**Push toward lockdown — always.** Once trusted numbers are in the allowlist, suggest
switching `dmPolicy` to `allowlist` so no new numbers can trigger pairing codes.

### `qr` — display QR code

The script prints the QR code as UTF-8 block art once and exits immediately.
It saves the QR art to `/tmp/whatsapp-qr.txt` and opens the PNG in the system viewer.

**After the script finishes**, Read `/tmp/whatsapp-qr.txt` and present it to the user
so they can see the full QR inline. Tell them the QR expires in ~60s and to run
`/whatsapp:configure qr` for a fresh one if needed.

### `pair <phone>` — pairing code flow

Pairing code is an alternative to QR scanning — useful for headless setups.

The script saves the phone, waits for the pairing code, then **polls for up to 2 minutes**
for the connection to complete. It auto-refreshes codes when they rotate.

- If the output contains `PAIRING_CODE_READY:`, display the code prominently and instruct
  the user: **Linked Devices → Link a Device → Link with phone number instead**.
- If `CONNECTED:` appears, confirm success.
- If `PAIRING_CODE_REFRESHED:`, show the new code (the old one expired).
- If `TIMEOUT:`, suggest the user retry with `/whatsapp:configure pair <phone>`.

### `logout` — unlink the device

Present the script's output to the user.

### `clear` — remove phone from state

Confirms removal of the saved phone number and pairing code.

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
