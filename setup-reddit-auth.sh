#!/bin/bash
set -euo pipefail

AUTH_DIR="$HOME/.config/reddit-dl"
AUTH_FILE="$AUTH_DIR/auth.conf"

printf "\nReddit auth helper voor WEBDL / reddit-dl\n"
printf "========================================\n\n"
printf "1) Maak (of check) eerst je Reddit script app op:\n"
printf "   https://www.reddit.com/prefs/apps\n\n"
printf "   Kies app type: script\n"
printf "   redirect uri: http://www.example.com/unused/redirect/uri\n\n"
printf "2) Vul hierna de 4 velden in.\n\n"

if command -v open >/dev/null 2>&1; then
  read -r -p "Wil je die pagina nu openen in je browser? [y/N]: " OPEN_NOW
  case "${OPEN_NOW:-}" in
    y|Y|yes|YES)
      open "https://www.reddit.com/prefs/apps" >/dev/null 2>&1 || true
      ;;
  esac
fi

read -r -p "client.id (personal use script): " CLIENT_ID
read -r -p "client.secret: " CLIENT_SECRET
read -r -p "username: " USERNAME
read -r -s -p "password (input verborgen): " PASSWORD
echo ""

trim() {
  local v="$1"
  # shellcheck disable=SC2001
  echo "$(echo "$v" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
}

CLIENT_ID="$(trim "$CLIENT_ID")"
CLIENT_SECRET="$(trim "$CLIENT_SECRET")"
USERNAME="$(trim "$USERNAME")"
PASSWORD="$(trim "$PASSWORD")"

if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
  echo "Fout: alle velden zijn verplicht."
  exit 1
fi

mkdir -p "$AUTH_DIR"

if [ -f "$AUTH_FILE" ]; then
  BACKUP_FILE="$AUTH_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  cp "$AUTH_FILE" "$BACKUP_FILE"
  echo "Bestaand auth.conf gebackupt naar: $BACKUP_FILE"
fi

cat > "$AUTH_FILE" <<EOF
client.id = $CLIENT_ID
client.secret = $CLIENT_SECRET
username = $USERNAME
password = $PASSWORD
EOF

chmod 600 "$AUTH_FILE"

echo ""
echo "Klaar. Bestand opgeslagen op: $AUTH_FILE"
echo "Permissies: 600"
echo ""
echo "Volgende stap: herstart StartServer.command zodat WEBDL_REDDIT_AUTH_FILE automatisch wordt opgepakt."
