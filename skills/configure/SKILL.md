---
name: configure
description: Set up the WhatsApp channel — authenticate via QR code or pairing code, and review access policy. Use when the user wants to connect WhatsApp, asks to configure it, says "how do I set this up", or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(cat *)
  - Bash(qrencode *)
  - Bash(python3 *)
---

# /whatsapp:configure — WhatsApp Channel Setup

Unlike Telegram (which uses a bot token), WhatsApp requires linking your personal
phone number via QR code or a pairing code. Auth state persists in
`~/.claude/channels/whatsapp/auth/` between sessions.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read state files and give the user a complete picture:

1. **Connection status** — read `~/.claude/channels/whatsapp/status.txt`:
   - `connected` → show connected number from `~/.claude/channels/whatsapp/me.txt`
   - `awaiting_qr` → tell user to run `/whatsapp:configure qr`
   - `logged_out` → instruct to re-link
   - `disconnected:*` → show the reason
   - Missing → not yet started

2. **Access** — read `~/.claude/channels/whatsapp/access.json` (missing = defaults:
   `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means in one line
   - Allowed senders: count and list JIDs
   - Pending pairings: count with codes

3. **What next** — end with a concrete next step:
   - Not connected → *"Run `/whatsapp:configure qr` to display the QR code,
     then scan with your WhatsApp app. Or run `/whatsapp:configure pair +5511999999999`
     to use a pairing code instead."*
   - Connected, nobody allowed → *"Send a WhatsApp message from your phone. The channel
     replies with a 6-char code; approve with `/whatsapp:access pair <code>`."*
   - Connected, someone allowed → *"Ready. Send a WhatsApp message from an approved
     number to reach Claude."*

**Push toward lockdown — always.** Once trusted numbers are in the allowlist, switch
`dmPolicy` from `pairing` to `allowlist` so no new numbers can trigger pairing codes.

### `qr` — display QR code

1. Check `~/.claude/channels/whatsapp/qr.txt`:
   - If present: render it as ASCII art so the user can scan with WhatsApp.
     Try `qrencode` first: `qrencode -t ANSIUTF8 "$(cat ~/.claude/channels/whatsapp/qr.txt)"`
     Fallback — if `qrencode` is not available, use python3:
     ```bash
     python3 -c "
     import sys
     try:
         import qrcode
         qr = qrcode.QRCode()
         qr.add_data(open('$HOME/.claude/channels/whatsapp/qr.txt').read().strip())
         qr.make(fit=True)
         qr.print_ascii(invert=True)
     except ImportError:
         print('Install qrencode or qrcode: pip install qrcode')
         print('Raw QR data:', open('$HOME/.claude/channels/whatsapp/qr.txt').read().strip()[:60], '...')
     "
     ```
   - QR codes rotate every ~20s — if the first one doesn't work, wait a moment and
     run `/whatsapp:configure qr` again.
   - After scanning: WhatsApp disconnects briefly, then reconnects automatically.
     Run `/whatsapp:configure` (no args) to verify `status.txt` shows `connected`.
   - If no `qr.txt`: the server may not be running, or it's already connected.
     Tell the user to start Claude with `--channels` and check connection status.

2. **Scan instructions:**
   - iOS: WhatsApp → Settings → Linked Devices → Link a Device
   - Android: WhatsApp → More options (⋮) → Linked Devices → Link a Device

### `pair <phone>` — pairing code flow

Pairing code is an alternative to QR scanning — useful for headless setups.

1. Treat `$ARGUMENTS` after `pair` as the phone number (strip non-digits).
   Example: `pair +55 11 99999-9999` → `55119999999`
2. `mkdir -p ~/.claude/channels/whatsapp`
3. Read existing `.env` if present; update or add the `WHATSAPP_PHONE=` line,
   preserve other keys. Write back, no quotes around the value.
4. `chmod 600 ~/.claude/channels/whatsapp/.env`
5. Tell the user: *"Phone number saved. The channel will request a pairing code on
   next connection. Run `/whatsapp:configure` to check status. When the code appears,
   on WhatsApp go to: Linked Devices → Link a Device → Link with phone number instead."*
6. Note: a session restart or `/reload-plugins` is required for the new phone to take effect.

### `logout` — unlink the device

1. Remove the auth directory: `rm -rf ~/.claude/channels/whatsapp/auth/`
2. Remove status and me files: `rm -f ~/.claude/channels/whatsapp/{status.txt,me.txt,qr.txt,pairing_code.txt}`
3. Confirm: *"Unlinked. On WhatsApp you can also remove this linked device under
   Settings → Linked Devices. Run `/whatsapp:configure qr` to re-link."*

### `clear` — remove phone from .env

Delete the `WHATSAPP_PHONE=` line (or the file if that's the only line).

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing = not configured.
- The server reads `.env` once at boot. Phone changes need a session restart or
  `/reload-plugins`. Say so after saving.
- `access.json` is re-read on every inbound message — policy changes take effect immediately.
- QR codes expire quickly (~60s for first, ~20s for subsequent). If scanning fails, re-run
  `/whatsapp:configure qr` to get the next QR.
- WhatsApp limits linked devices to 4. If the user has 4 already, they'll need to unlink
  one first from their phone.
