# Contributing

## Dev setup

```bash
git clone https://github.com/mgiovani/claude-whatsapp-channel
cd claude-whatsapp-channel
npm install          # runtime deps (Node.js)
bun install          # also installs devDeps for testing
```

**Requirements:**
- Node.js v22+ (runtime — Baileys needs full WebSocket support that Bun lacks)
- Bun v1.0+ (test runner only)

## Running tests

```bash
bun test
```

Tests cover `lib.ts` pure functions: JID helpers, access gate logic, message parsing, text formatting, chunking.

## Running locally

```bash
# Start Claude Code with the channel loaded from your local checkout:
make dev
# or:
claude --dangerously-load-development-channels server:whatsapp
```

Then follow the setup steps in the README to link a WhatsApp account and test end-to-end.

## Project structure

- `server.ts` — MCP server, WhatsApp connection (Baileys), message routing, tool handlers
- `lib.ts` — pure functions (access control, JID resolution, message parsing, text formatting)
- `lib.test.ts` — unit tests for lib.ts
- `skills/` — Claude Code skill prompts (`/whatsapp:configure`, `/whatsapp:access`)
- `scripts/` — shell helpers for status/QR display/logout

## Pull requests

- Follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`)
- Keep PRs focused — one logical change per PR
- Add or update tests in `lib.test.ts` for any changes to `lib.ts`
- For behavior changes, update the relevant skill docs in `skills/`

## Reporting issues

Use [GitHub Issues](https://github.com/mgiovani/claude-whatsapp-channel/issues). For security vulnerabilities, email `e@giovani.dev` directly instead of opening a public issue.
