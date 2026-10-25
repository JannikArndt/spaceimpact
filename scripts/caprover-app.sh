#!/usr/bin/env bash
# Register (or update) one app on a CapRover server, non-interactively.
#
# Why this exists rather than clicking through the dashboard: the dashboard
# is the only *documented* way to create an app and mint a deploy token, but
# everything the dashboard does is just calls to CapRover's own HTTP API —
# and the `caprover` CLI ships a sanctioned "call the API" escape hatch
# (`caprover api`) for exactly this. The paths and field names below were
# read out of caprover/caprover's server source (src/routes/user/apps/
# appdefinition/AppDefinitionRouter.ts and the AppDefinitionHandler behind
# it), not guessed — CapRover does not publish this API as a stable public
# contract, so if a future CapRover major version moves these routes, this
# script is the one place that needs updating.
#
# Idempotent: safe to re-run. Registering an already-registered app is a
# no-op (CapRover errors on double-register; this script checks first).
# Re-running with the same APP_TOKEN just re-asserts the same config.
#
# Required environment (the caprover CLI reads these itself — see
# `npx caprover@$CLI_VERSION deploy --help`):
#   CAPROVER_URL       e.g. https://captain.timpanini.com
#   CAPROVER_PASSWORD  the CapRover server login password
#     -- or, if you've already run `caprover login` on this machine --
#   CAPROVER_NAME      the machine name you logged in as
#
# Required argument:
#   $1  APP_NAME  (becomes the CapRover app name AND, by default, the
#                  subdomain: https://<APP_NAME>.<rootDomain>)
#
# Optional environment:
#   HAS_PERSISTENT_DATA=false   set true if the app writes state to disk
#                                that must survive a redeploy
#   VOLUME_CONTAINER_PATH       e.g. /data — only used if HAS_PERSISTENT_DATA
#                                is true; mounts a CapRover-managed volume
#                                named "<APP_NAME>-data" there
#   CONTAINER_HTTP_PORT         only if the app doesn't listen on 80
#   ENABLE_HTTPS=true           runs Let's Encrypt for the default subdomain
#   APP_TOKEN                   reuse an existing token instead of minting
#                                a new one (e.g. when re-running this script)
#
# Prints, on success:
#   APP_NAME=<name>
#   APP_TOKEN=<token>      <- this is the whole secret; save it now, CapRover
#                              does not let you read it back later, only
#                              rotate it (re-run with a fresh APP_TOKEN unset)
#   APP_URL=https://<name>.<rootDomain>
#
# Those three lines are meant to be eval'd or grepped by whatever called
# this script (a human, or the rest of the timpanini skill setting GitHub
# secrets).

set -euo pipefail

CLI_VERSION="2.4.4" # pinned; bump deliberately after checking `npm view caprover version`

APP_NAME="${1:?usage: caprover-app.sh <app-name>}"
HAS_PERSISTENT_DATA="${HAS_PERSISTENT_DATA:-false}"
ENABLE_HTTPS="${ENABLE_HTTPS:-true}"

: "${CAPROVER_URL:?set CAPROVER_URL, e.g. https://captain.timpanini.com}"
if [ -z "${CAPROVER_PASSWORD:-}" ] && [ -z "${CAPROVER_NAME:-}" ]; then
  echo "error: set CAPROVER_PASSWORD (or CAPROVER_NAME if already logged in)" >&2
  exit 1
fi

cap() {
  # $1 = path (starting with /user/...), $2 = method, $3 = JSON data or ''
  # Always pass -d: without it `caprover api` opens an interactive prompt.
  local path="$1" method="$2" data="${3:-{\}}"
  npx --yes "caprover@$CLI_VERSION" api -t "$path" -m "$method" -d "$data" -o true
}

# --- does the app already exist? -------------------------------------------
listing="$(cap "/user/apps/appDefinitions/" GET)"
root_domain="$(node -e '
  const r = JSON.parse(process.argv[1]);
  process.stdout.write(r.data && r.data.rootDomain || "");
' "$listing")"
exists="$(node -e '
  const r = JSON.parse(process.argv[1]);
  const name = process.argv[2];
  const apps = (r.data && r.data.appDefinitions) || [];
  process.stdout.write(apps.some(a => a.appName === name) ? "yes" : "no");
' "$listing" "$APP_NAME")"

if [ "$exists" = "no" ]; then
  echo "creating app '$APP_NAME'..." >&2
  cap "/user/apps/appDefinitions/register/" POST \
    "$(node -e 'console.log(JSON.stringify({appName: process.argv[1], hasPersistentData: process.argv[2] === "true"}))' "$APP_NAME" "$HAS_PERSISTENT_DATA")" \
    >/dev/null
else
  echo "app '$APP_NAME' already exists, configuring in place" >&2
fi

# --- mint (or reuse) the deploy token ---------------------------------------
# CapRover does not generate this server-side: the caller picks the token
# and tells the server to accept it. A UUID is exactly as good as anything
# CapRover would have generated itself.
if [ -z "${APP_TOKEN:-}" ]; then
  APP_TOKEN="$(node -e 'console.log(require("crypto").randomUUID())')"
fi

# --- one partial update: token, port, volume, all in a single PATCH --------
# PATCH /update/ merges into the existing app config (unlike POST /update/,
# which replaces it wholesale) — see references/caprover-api.md. That's the
# whole reason this script is safe to re-run against a hand-configured app
# without clobbering settings it didn't touch.
patch_body="$(node -e '
  const [appName, token, hasPersistent, volumePath, httpPort] = process.argv.slice(1);
  const body = {
    appName,
    appDeployTokenConfig: { enabled: true, appDeployToken: token },
  };
  if (hasPersistent === "true" && volumePath) {
    body.volumes = [{ containerPath: volumePath, volumeName: appName + "-data" }];
  }
  if (httpPort) {
    body.containerHttpPort = Number(httpPort);
  }
  console.log(JSON.stringify(body));
' "$APP_NAME" "$APP_TOKEN" "$HAS_PERSISTENT_DATA" "${VOLUME_CONTAINER_PATH:-}" "${CONTAINER_HTTP_PORT:-}")"

cap "/user/apps/appDefinitions/update/" PATCH "$patch_body" >/dev/null

# --- HTTPS on the default subdomain -----------------------------------------
if [ "$ENABLE_HTTPS" = "true" ]; then
  echo "requesting Let's Encrypt cert for $APP_NAME.$root_domain..." >&2
  cap "/user/apps/appDefinitions/enablebasedomainssl/" POST \
    "$(node -e 'console.log(JSON.stringify({appName: process.argv[1]}))' "$APP_NAME")" \
    >/dev/null || echo "warning: HTTPS enable failed — DNS for *.$root_domain may not be pointed here yet; re-run later" >&2
fi

echo "APP_NAME=$APP_NAME"
echo "APP_TOKEN=$APP_TOKEN"
echo "APP_URL=https://$APP_NAME.$root_domain"
