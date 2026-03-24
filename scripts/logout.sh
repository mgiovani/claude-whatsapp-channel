#!/usr/bin/env bash
# Unlinks the WhatsApp device by removing auth state. Used by /whatsapp:configure skill.
set -euo pipefail

STATE_DIR="${HOME}/.claude/channels/whatsapp"

rm -rf "${STATE_DIR}/auth/"
rm -rf "${STATE_DIR}/approved/"
rm -f "${STATE_DIR}/status.txt" "${STATE_DIR}/me.txt" "${STATE_DIR}/qr.txt" "${STATE_DIR}/pairing_code.txt"
rm -f "${STATE_DIR}/lid-mapping.json"

# Reset access.json to defaults (clear allowlist, pending pairings)
if [[ -f "${STATE_DIR}/access.json" ]]; then
  cat > "${STATE_DIR}/access.json" <<'EOF'
{
  "dmPolicy": "pairing",
  "allowFrom": [],
  "groups": {},
  "pending": {}
}
EOF
  chmod 600 "${STATE_DIR}/access.json"
  echo "Access: Cleared allowlist and pending pairings."
fi

# Remove saved phone number
if [[ -f "${STATE_DIR}/.env" ]]; then
  rm -f "${STATE_DIR}/.env"
  echo "Phone: Removed saved phone number from .env."
fi

echo "Auth: Session unlinked and auth state removed."
echo ""
echo "On WhatsApp, you can also remove this linked device under:"
echo "  Settings → Linked Devices → select the device → Unlink"
echo ""
echo "To re-link, the server will auto-generate a new QR code."
echo "Run /whatsapp:configure to see it (or restart the channel server if needed)."
echo ""
echo "Note: If WhatsApp blocks linking ('cannot connect new devices'), wait"
echo "10-30 minutes — WhatsApp rate-limits frequent link/unlink cycles."
