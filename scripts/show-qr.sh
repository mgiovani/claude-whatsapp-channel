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
    print('ERROR: QR renderer not found. Install one of:')
    print('  macOS:  brew install qrencode  OR  pip3 install qrcode[pil]')
    print('  Linux:  apt install qrencode   OR  pip3 install qrcode[pil]')
    print()
    print('Then run /whatsapp:configure qr again.')
    print()
    print('Alternatively, use the pairing code flow:')
    print('  /whatsapp:configure pair +<your-phone-number>')
"
else
  echo "ERROR: No QR renderer available (qrencode not found, python3 not found)."
  echo ""
  echo "Install a renderer:"
  echo "  macOS:  brew install qrencode  OR  pip3 install qrcode[pil]"
  echo "  Linux:  apt install qrencode   OR  pip3 install qrcode[pil]"
  echo ""
  echo "Or use the pairing code flow instead:"
  echo "  /whatsapp:configure pair +<your-phone-number>"
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
