#!/usr/bin/env bash
#
# Imprime un JWT de desarrollo para probar la API a mano.
#
# El backend todavía no tiene endpoint de login (ver models/JwtPayload: el trait
# AuthorizedAction solo verifica tokens que otro componente firmó), así que sin
# esto no hay forma de llamar a /admin/* desde curl. Es una herramienta de
# desarrollo, no un mecanismo de autenticación: firma con el mismo secreto que el
# servidor, y cualquiera que lo tenga puede ser admin.
#
# Uso:
#   scripts/dev-token.sh                        # admin, 1 hora
#   scripts/dev-token.sh passenger 7 juan@x.com  # otro rol, 1 hora
#   scripts/dev-token.sh admin 1 laura@x.com 8  # ... 8 horas
#
# Ejemplo:
#   TOKEN=$(./scripts/dev-token.sh)
#   curl -H "Authorization: Bearer $TOKEN" localhost:8080/admin/aeropuertos
#   curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
#     -d @vuelo.json localhost:8080/admin/vuelos
#
# Variables de entorno:
#   AERONET_JWT_SECRET  tiene que coincidir con el del servidor (obligatorio)
#   AERONET_JWT_ISSUER  por defecto "aeronet", como en application.conf

set -euo pipefail

ROL="${1:-admin}"
USER_ID="${2:-1}"
EMAIL="${3:-laura.mendez@aeronet.com.ar}"
HORAS="${4:-1}"

# Mismo secreto y mismo issuer que el servidor: si no coinciden, el token se
# firma bien pero el servidor lo rechaza y el 403 parece un problema de permisos.
SECRET="${AERONET_JWT_SECRET:-}"
if [[ -z "$SECRET" ]]; then
  echo "Falta AERONET_JWT_SECRET. El token tiene que firmarse con el mismo" >&2
  echo "secreto con el que corre el servidor, o el backend lo va a rechazar." >&2
  exit 1
fi
ISSUER="${AERONET_JWT_ISSUER:-aeronet}"

command -v openssl >/dev/null 2>&1 || {
  echo "Falta openssl, que es lo unico que necesita este script." >&2
  exit 1
}

# Los permisos de cada rol salen de models/Models.scala. El backend igual
# acepta cualquier usuario con rol admin (AuthorizedAction.hasPermission), asi
# que la lista es informative.
permisos_de() {
  case "$1" in
    admin)
      echo '["manage_users","manage_system","manage_tickets","view_reports","manage_schedules"]'
      ;;
    counter_employee)
      echo '["manage_tickets","sell_tickets","view_reports","view_history"]'
      ;;
    passenger)
      echo '["book_tickets","view_history","update_profile"]'
      ;;
    *)
      echo '[]'
      ;;
  esac
}

# base64url: base64 de OpenSSL con el relleno cortado y los dos caracteres
# problematicos cambiados, que es lo que exige JWT.
b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

ahora="$(date +%s)"
vence="$((ahora + HORAS * 3600))"

header="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)"

# exp e iat van como enteros: java-jwt los lee como Instante y un string los
# rompe con un error que no es JWTVerificationException.
payload="$(
  printf '{"iss":"%s","sub":"%s","userId":%s,"email":"%s","roles":["%s"],"permissions":%s,"iat":%s,"exp":%s}' \
    "$ISSUER" "$EMAIL" "$USER_ID" "$EMAIL" "$ROL" "$(permisos_de "$ROL")" "$ahora" "$vence" |
    b64url
)"

firmar="$header.$payload"
# -mac HMAC -macopt hexkey: espera la clave en hex, no en texto plano.
firma="$(printf '%s' "$firmar" | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$(printf '%s' "$SECRET" | xxd -p | tr -d '\n')" -binary | b64url)"

echo "$firmar.$firma"
