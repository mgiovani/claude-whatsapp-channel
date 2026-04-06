# Changelog

All notable changes to this project will be documented here.

## [0.1.0] — 2026-04-06

Initial public release.

### Features

- QR code and pairing code linking for WhatsApp multi-device
- Access control: allowlist, pairing codes, DM policy (`pairing` / `allowlist` / `disabled`)
- Group chat support with configurable mention gating and per-sender allowlists
- MCP tools: `reply`, `react`, `edit_message`, `download_attachment`
- Auto-reconnect with exponential backoff; fast reconnect on `connectionReplaced`
- Audio transcription via Groq or OpenAI Whisper (pluggable, requires API key)
- Long-reply document mode: responses above a configurable char threshold sent as `.md`/`.txt` attachments
- Markdown-to-WhatsApp format conversion (bold, italic, code, lists, headers, HR)
- Inbound quote context: quoted messages prepended when user replies to a message
- Typing presence indicator on inbound messages
- LID-to-JID resolution for contacts that use WhatsApp's linked-device identifiers
- `/whatsapp:configure` and `/whatsapp:access` Claude Code skills
- Permission relay: tool-use approvals forwarded to WhatsApp for remote approval
- Rate limiting (500ms between chunks) to reduce automation detection risk
