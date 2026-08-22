#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script as root" >&2
  exit 1
fi

RFC_ENV=${RFC_ENV:-/srv/logali/secrets/sap-rfc-guard.env}
IDOC_ENV=${IDOC_ENV:-/srv/logali/secrets/sap-idoc-guard.env}
RFC_TLS=${RFC_TLS:-/srv/logali/tls/sap-rfc-guard-jco}
IDOC_TLS=${IDOC_TLS:-/srv/logali/tls/sap-idoc-guard-jco}

test -r "${RFC_ENV}"
test -r "${RFC_TLS}/ca.crt"
test -r "${RFC_TLS}/ca.key"

umask 077
mkdir -p "${IDOC_TLS}" "$(dirname "${IDOC_ENV}")"

if [[ ! -s ${IDOC_TLS}/server.key || ! -s ${IDOC_TLS}/server.crt ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 \
    -out "${IDOC_TLS}/server.key" >/dev/null 2>&1
  openssl req -new -key "${IDOC_TLS}/server.key" \
    -out "${IDOC_TLS}/server.csr" \
    -subj "/CN=sap-idoc-guard-jco" \
    -addext "subjectAltName=DNS:sap-idoc-guard-jco,DNS:sap-idoc-guard,DNS:localhost,IP:127.0.0.1" \
    >/dev/null 2>&1
  openssl x509 -req -in "${IDOC_TLS}/server.csr" \
    -CA "${RFC_TLS}/ca.crt" -CAkey "${RFC_TLS}/ca.key" \
    -CAserial "${RFC_TLS}/ca.srl" -days 825 -sha256 -copy_extensions copyall \
    -out "${IDOC_TLS}/server.crt" >/dev/null 2>&1
fi

# shellcheck disable=SC1090
set -a
source "${RFC_ENV}"
set +a

if [[ -s ${IDOC_ENV} ]]; then
  api_token=$(sed -n 's/^IDOC_GUARD_API_TOKEN=//p' "${IDOC_ENV}")
  keystore_password=$(sed -n 's/^IDOC_GUARD_TLS_KEYSTORE_PASSWORD=//p' "${IDOC_ENV}")
else
  api_token=$(openssl rand -hex 32)
  keystore_password=$(openssl rand -hex 32)
fi

[[ ${#api_token} -ge 32 ]]
[[ ${#keystore_password} -ge 32 ]]

p12_tmp=$(mktemp)
openssl pkcs12 -export -inkey "${IDOC_TLS}/server.key" \
  -in "${IDOC_TLS}/server.crt" -certfile "${RFC_TLS}/ca.crt" \
  -name sap-idoc-guard-jco -passout "pass:${keystore_password}" \
  -out "${p12_tmp}" >/dev/null 2>&1
install -o root -g root -m 0640 "${p12_tmp}" "${IDOC_TLS}/server.p12"
chown root:10001 "${IDOC_TLS}/server.p12"
install -o root -g root -m 0644 "${RFC_TLS}/ca.crt" "${IDOC_TLS}/ca.crt"

env_tmp=$(mktemp)
printf '%s\n' \
  "IDOC_GUARD_API_TOKEN=${api_token}" \
  'IDOC_GUARD_ENABLE_OUTBOUND=true' \
  'IDOC_GUARD_ENABLE_INBOUND=false' \
  'IDOC_GUARD_ENABLE_INBOUND_PAYLOAD_READ=false' \
  'IDOC_GUARD_STATE_DIR=/var/lib/sap-idoc-guard' \
  'IDOC_GUARD_REQUEST_TIMEOUT_SECONDS=60' \
  'IDOC_GUARD_MAX_SEGMENTS=20' \
  'IDOC_GUARD_TLS_KEYSTORE=/run/secrets/sap-idoc-guard-server.p12' \
  "IDOC_GUARD_TLS_KEYSTORE_PASSWORD=${keystore_password}" \
  'IDOC_GUARD_HEALTH_HOST=localhost' \
  'IDOC_OUTBOUND_OPERATION=submitPurchaseOrderIdoc' \
  'IDOC_MESSAGE_TYPE=ORDERS' \
  'IDOC_BASIC_TYPE=ORDERS05' \
  'IDOC_EXTENSION=' \
  'IDOC_ALLOWED_SEGMENTS=EDI_DC40,E1EDK01,E1EDKA1,E1EDP01,E1EDP19' \
  'IDOC_SENDER_PARTNER_TYPE=LS' \
  'IDOC_SENDER_PARTNER=N8NIDOC' \
  'IDOC_RECEIVER_PARTNER_TYPE=LS' \
  'IDOC_RECEIVER_PARTNER=A4HCLNT250' \
  'IDOC_RECEIVER_PORT=SAPA4H' \
  'SAP_DESTINATION_NAME=SAP_IDOC_GUARD' \
  "SAP_ASHOST=${SAP_ASHOST}" \
  "SAP_SYSNR=${SAP_SYSNR}" \
  "SAP_CLIENT=${SAP_CLIENT}" \
  "SAP_USER=${SAP_USER}" \
  "SAP_PASSWORD=${SAP_PASSWORD}" \
  "SAP_LANG=${SAP_LANG:-EN}" \
  "SAP_POOL_CAPACITY=${SAP_POOL_CAPACITY:-3}" \
  "SAP_PEAK_LIMIT=${SAP_PEAK_LIMIT:-10}" >"${env_tmp}"
install -o root -g root -m 0600 "${env_tmp}" "${IDOC_ENV}"

openssl x509 -in "${IDOC_TLS}/server.crt" -noout -checkend 2592000 >/dev/null
openssl pkcs12 -in "${IDOC_TLS}/server.p12" -passin "pass:${keystore_password}" \
  -noout >/dev/null 2>&1
echo "SAP IDoc Guard server secrets and TLS are ready"
