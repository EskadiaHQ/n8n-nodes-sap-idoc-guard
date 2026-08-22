#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME=n8n-nodes-sap-idoc-guard
PACKAGE_VERSION=0.1.8
PACKAGE_FILE="${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz"
EXPECTED_SHA256=cac16b06445d46ba10c66d74515e346d1fbfc59f370aea07cf2f20c71f556379
CONTAINER="${N8N_CONTAINER:-logali-n8n-restore-n8n-1}"
PACKAGE_PATH="${1:-}"

if [[ -z "$PACKAGE_PATH" || ! -f "$PACKAGE_PATH" ]]; then
  echo "Uso: sudo $0 /ruta/$PACKAGE_FILE" >&2
  exit 2
fi

actual_sha=$(sha256sum "$PACKAGE_PATH" | awk '{print $1}')
if [[ "$actual_sha" != "$EXPECTED_SHA256" ]]; then
  echo "ERROR: SHA-256 inesperado para $PACKAGE_PATH" >&2
  exit 1
fi

state=$(docker inspect -f '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}:{{json .HostConfig.PortBindings}}' "$CONTAINER")
if [[ "$state" != 'running:healthy:{}' ]]; then
  echo "ERROR: estado previo inseguro para $CONTAINER: $state" >&2
  exit 1
fi

docker cp "$PACKAGE_PATH" "$CONTAINER:/tmp/$PACKAGE_FILE"

docker exec \
  -e PACKAGE_NAME="$PACKAGE_NAME" \
  -e PACKAGE_VERSION="$PACKAGE_VERSION" \
  -e PACKAGE_FILE="$PACKAGE_FILE" \
  -e EXPECTED_SHA256="$EXPECTED_SHA256" \
  -u node "$CONTAINER" sh -eu -c '
base=/home/node/.n8n/nodes
packages=/home/node/.n8n/packages
manifest="$base/package.json"
target="$base/node_modules/$PACKAGE_NAME"
source_tgz="/tmp/$PACKAGE_FILE"
persistent_tgz="$packages/$PACKAGE_FILE"
stamp=$(date -u +%Y%m%dT%H%M%SZ)

test -f "$manifest"
mkdir -p "$base/node_modules" "$packages"

actual_sha=$(sha256sum "$source_tgz" | awk "{print \$1}")
test "$actual_sha" = "$EXPECTED_SHA256"

if [ -e "$target" ]; then
  installed=$(node -p "require(\"$target/package.json\").version")
  if [ "$installed" = "$PACKAGE_VERSION" ]; then
    NODE_PATH=/usr/local/lib/node_modules/n8n/node_modules node -e "
    require(\"$target/dist/nodes/SapIdocGuard/SapIdocGuard.node.js\");
    require(\"$target/dist/credentials/SapIdocGuardApi.credentials.js\");
    "
    echo "$PACKAGE_NAME@$PACKAGE_VERSION ya estaba instalado"
    exit 0
  fi
  case "$installed" in
    0.1.0|0.1.1|0.1.2|0.1.3|0.1.4|0.1.5|0.1.6|0.1.7) ;;
    *)
      echo "ERROR: actualización no prevista desde $PACKAGE_NAME@$installed" >&2
      exit 1
      ;;
  esac
fi

stage=$(mktemp -d "/tmp/${PACKAGE_NAME}.XXXXXX")
trap "rm -rf -- \"$stage\"" EXIT

npm install \
  --prefix "$stage" \
  --no-save \
  --package-lock=false \
  --ignore-scripts \
  --omit=dev \
  --legacy-peer-deps \
  --no-audit \
  --no-fund \
  "$source_tgz" >/dev/null

test -f "$stage/node_modules/$PACKAGE_NAME/package.json"
count=$(find "$stage/node_modules" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d " ")
test "$count" = 1

cp "$source_tgz" "$persistent_tgz.new-$stamp"
mv "$persistent_tgz.new-$stamp" "$persistent_tgz"
cp -a "$stage/node_modules/$PACKAGE_NAME" "$target.new-$stamp"

NODE_PATH=/usr/local/lib/node_modules/n8n/node_modules node -e "
const target=\"$target.new-$stamp\";
const p=require(target+\"/package.json\");
if(p.name!==\"$PACKAGE_NAME\"||p.version!==\"$PACKAGE_VERSION\") process.exit(1);
require(target+\"/dist/nodes/SapIdocGuard/SapIdocGuard.node.js\");
require(target+\"/dist/credentials/SapIdocGuardApi.credentials.js\");
"

cp "$manifest" "$manifest.pre-sap-idoc-guard-$stamp"
MANIFEST="$manifest" OUTPUT="$manifest.new-$stamp" PACKAGE_NAME="$PACKAGE_NAME" PACKAGE_FILE="$PACKAGE_FILE" node <<"NODE"
const fs = require("fs");
const manifest = process.env.MANIFEST;
const output = process.env.OUTPUT;
const packageName = process.env.PACKAGE_NAME;
const packageFile = process.env.PACKAGE_FILE;
const data = JSON.parse(fs.readFileSync(manifest, "utf8"));
data.dependencies ||= {};
data.dependencies[packageName] = `file:../packages/${packageFile}`;
fs.writeFileSync(output, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o644 });
NODE

if [ -e "$target" ]; then
  installed=$(node -p "require(\"$target/package.json\").version")
  previous="$packages/${PACKAGE_NAME}-${installed}.pre-${PACKAGE_VERSION}-$stamp"
  mv "$target" "$previous"
fi

mv "$target.new-$stamp" "$target"
mv "$manifest.new-$stamp" "$manifest"

if ! NODE_PATH=/usr/local/lib/node_modules/n8n/node_modules node -e "
const p=require(\"$target/package.json\");
if(p.name!==\"$PACKAGE_NAME\"||p.version!==\"$PACKAGE_VERSION\") process.exit(1);
require(\"$target/dist/nodes/SapIdocGuard/SapIdocGuard.node.js\");
require(\"$target/dist/credentials/SapIdocGuardApi.credentials.js\");
"; then
  failed="$packages/${PACKAGE_NAME}-${PACKAGE_VERSION}.failed-$stamp"
  mv "$target" "$failed"
  if [ -n "${previous:-}" ]; then mv "$previous" "$target"; fi
  cp "$manifest.pre-sap-idoc-guard-$stamp" "$manifest"
  echo "ERROR: verificación posterior fallida; rollback aplicado" >&2
  exit 1
fi

echo "installed=$PACKAGE_NAME@$PACKAGE_VERSION previous=${previous:-none} manifest_backup=$manifest.pre-sap-idoc-guard-$stamp"
'
