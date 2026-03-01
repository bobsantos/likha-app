#!/bin/sh
# Cross-platform LAN IP detection and Docker Compose launcher.
# Usage: ./start.sh [any docker compose args, e.g. -d, --build]

detect_ip() {
  # macOS
  if command -v ipconfig >/dev/null 2>&1; then
    ipconfig getifaddr en0 2>/dev/null && return
    ipconfig getifaddr en1 2>/dev/null && return
  fi
  # Linux
  if command -v hostname >/dev/null 2>&1; then
    hostname -I 2>/dev/null | awk '{print $1}' && return
  fi
  # Windows (Git Bash / WSL)
  if command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' } | Select-Object -First 1).IPAddress" 2>/dev/null | tr -d '\r' && return
  fi
  echo ""
}

HOST_IP=$(detect_ip)

# Remove stale anonymous volumes (e.g. node_modules) so rebuilds pick up new deps
docker compose down -v 2>/dev/null

if [ -n "$HOST_IP" ]; then
  echo "  Detected host IP: $HOST_IP"
  HOST_IP="$HOST_IP" docker compose up --build "$@"
else
  echo "  Could not detect host IP — mobile access may not work."
  echo "  You can set it manually: HOST_IP=192.168.x.x ./start.sh"
  docker compose up --build "$@"
fi
