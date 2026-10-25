#!/usr/bin/env bash
# Attach a custom domain to an existing CapRover app, get a Let's Encrypt
# certificate for it, then force HTTPS. Same credentials and `caprover api`
# pattern as scripts/caprover-app.sh. Routes used (all POST/PATCH under
# /api/v2/user/apps/appDefinitions): /customdomain/, /enablecustomdomainssl/,
# PATCH /update/ with forceSsl.
#
# Run it only after the domain's DNS record points at the CapRover server:
# CapRover checks that the domain reaches its nginx before accepting it.
#
#   CAPROVER_URL=https://captain.timpanini.com CAPROVER_PASSWORD='…' \
#     ./scripts/connect-domain.sh spaceimpact spaceimpact.jannikarndt.de

set -euo pipefail
CLI_VERSION="2.4.4"
APP_NAME="${1:?usage: connect-domain.sh <app-name> <domain>}"
DOMAIN="${2:?usage: connect-domain.sh <app-name> <domain>}"
: "${CAPROVER_URL:?set CAPROVER_URL, e.g. https://captain.timpanini.com}"
if [ -z "${CAPROVER_PASSWORD:-}" ] && [ -z "${CAPROVER_NAME:-}" ]; then
  echo "error: set CAPROVER_PASSWORD (or CAPROVER_NAME if already logged in)" >&2
  exit 1
fi

cap() { npx --yes "caprover@$CLI_VERSION" api -t "$1" -m "$2" -d "$3" -o true; }
body="$(node -e 'console.log(JSON.stringify({appName: process.argv[1], customDomain: process.argv[2]}))' "$APP_NAME" "$DOMAIN")"

echo "connecting $DOMAIN to $APP_NAME..." >&2
cap "/user/apps/appDefinitions/customdomain/" POST "$body" >/dev/null

echo "requesting Let's Encrypt cert for $DOMAIN..." >&2
cap "/user/apps/appDefinitions/enablecustomdomainssl/" POST "$body" >/dev/null

echo "forcing HTTPS..." >&2
cap "/user/apps/appDefinitions/update/" PATCH \
  "$(node -e 'console.log(JSON.stringify({appName: process.argv[1], forceSsl: true}))' "$APP_NAME")" >/dev/null

echo "done: https://$DOMAIN"
