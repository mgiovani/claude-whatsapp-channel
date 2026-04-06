#!/usr/bin/env bash
# Prints WhatsApp channel status summary. Used by /whatsapp:configure skill.
set -euo pipefail

STATE_DIR="${HOME}/.claude/channels/whatsapp"

# --- Connection (from state.json) ---
status="not_started"
me=""
if [[ -f "${STATE_DIR}/state.json" ]] && command -v python3 &>/dev/null; then
  eval "$(python3 -c "
import json, sys
try:
    s = json.load(open('${STATE_DIR}/state.json'))
    print('status=' + repr(s.get('status', 'not_started')))
    print('me=' + repr(s.get('myJid', '')))
except Exception:
    print('status=not_started')
    print('me=')
")"
fi

echo "CONNECTION: ${status}"
if [[ -n "$me" ]]; then
  # Extract just the phone number (before : or @)
  phone=$(echo "$me" | sed 's/[@:].*$//')
  echo "LINKED_NUMBER: ${phone}"
fi

# --- Access ---
if [[ -f "${STATE_DIR}/access.json" ]]; then
  # Use python3/node to parse JSON — available on all platforms
  if command -v python3 &>/dev/null; then
    python3 -c "
import json, sys
try:
    a = json.load(open('${STATE_DIR}/access.json'))
except Exception:
    print('ACCESS_ERROR: cannot parse access.json')
    sys.exit(0)

print(f'DM_POLICY: {a.get(\"dmPolicy\", \"pairing\")}')

allow = a.get('allowFrom', [])
print(f'ALLOWED_COUNT: {len(allow)}')
for jid in allow:
    print(f'  ALLOWED: {jid}')

pending = a.get('pending', {})
print(f'PENDING_COUNT: {len(pending)}')
for code, p in pending.items():
    print(f'  PENDING: {code} from {p.get(\"senderId\", \"?\")}')

groups = a.get('groups', {})
print(f'GROUPS_COUNT: {len(groups)}')
for gid in groups:
    print(f'  GROUP: {gid}')
"
  else
    echo "DM_POLICY: unknown (python3 not available to parse JSON)"
  fi
else
  echo "DM_POLICY: pairing (default — no access.json yet)"
  echo "ALLOWED_COUNT: 0"
  echo "PENDING_COUNT: 0"
  echo "GROUPS_COUNT: 0"
fi

# --- Phone config ---
if [[ -f "${STATE_DIR}/.env" ]] && grep -q '^WHATSAPP_PHONE=' "${STATE_DIR}/.env" 2>/dev/null; then
  phone_cfg=$(grep '^WHATSAPP_PHONE=' "${STATE_DIR}/.env" | cut -d= -f2)
  echo "PAIRING_PHONE: ${phone_cfg}"
else
  echo "PAIRING_PHONE: none"
fi
