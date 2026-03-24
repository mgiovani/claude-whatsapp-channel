#!/usr/bin/env bash
# Renders the WhatsApp QR code for scanning. Used by /whatsapp:configure skill.
set -euo pipefail

STATE_DIR="${HOME}/.claude/channels/whatsapp"
QR_FILE="${STATE_DIR}/qr.txt"

if [[ ! -f "$QR_FILE" ]]; then
  echo "NO_QR: No QR code available."
  echo "The server may not be running, or it's already connected."
  echo "Check status with: /whatsapp:configure"
  exit 0
fi

qr_data=$(cat "$QR_FILE")
if [[ -z "$qr_data" ]]; then
  echo "NO_QR: QR file is empty."
  exit 0
fi

# Try qrencode first (fast, widely available)
if command -v qrencode &>/dev/null; then
  qrencode -t UTF8 "$qr_data"
# Fallback: python3 qrcode module
elif command -v python3 &>/dev/null; then
  python3 -c "
import sys
try:
    import qrcode
    qr = qrcode.QRCode()
    qr.add_data('''$qr_data''')
    qr.make(fit=True)
    qr.print_ascii(invert=True)
except ImportError:
    print('ERROR: Install qrencode or python3-qrcode:')
    print('  apt install qrencode  OR  pip install qrcode')
    print()
    print('Raw QR data (first 80 chars):')
    print('''${qr_data}'''[:80] + '...')
"
else
  echo "ERROR: No QR renderer available."
  echo "Install qrencode: apt install qrencode"
  echo ""
  echo "Raw QR data (first 80 chars):"
  echo "${qr_data:0:80}..."
fi

echo ""
echo "--- Scan instructions ---"
echo "Open WhatsApp on your phone:"
echo "  iOS:     Settings → Linked Devices → Link a Device"
echo "  Android: More options (⋮) → Linked Devices → Link a Device"
echo ""
echo "Then point your camera at the QR code above."
echo ""
echo "Note: This is an unofficial integration — use at your own risk."
echo "QR codes rotate every ~20s. Run /whatsapp:configure qr for a fresh one if needed."
