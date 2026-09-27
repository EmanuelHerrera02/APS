#!/usr/bin/env bash
#
# Recrea una base desde cero, por defecto la de desarrollo.
#
# Es wrapper de reset-test-db.sh, que ya sabe cargar los tres scripts de db/ con
# el nombre de base que corresponda. Este existe porque el truco de
# TEST_DB=aeronet para reconstruir la base de desarrollo no es obvio, y vale
# dejar el comando escrito en un lado con nombre.
#
# Uso:
#   scripts/db-reset.sh                    # aeronet (desarrollo)
#   scripts/db-reset.sh aeronet_test       # la de test
#
# Variables de entorno opcionales:
#   MARIADB_CLIENT  ruta al cliente mariadb
#   DB_USER         por defecto root

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${1:-aeronet}"

export TEST_DB="$BASE"
export MARIADB_CLIENT="${MARIADB_CLIENT:-/tmp/opencode/mdb/usr/bin/mariadb}"

if ! "$MARIADB_CLIENT" --socket="${MARIADB_HOME:-/tmp/opencode/mdb}/run/mysqld.sock" \
  --host=127.0.0.1 --user="${DB_USER:-root}" -e "SELECT 1" >/dev/null 2>&1; then
  echo "No se pudo conectar con MariaDB. Levantalo con scripts/db-up.sh" >&2
  exit 1
fi

exec "$RAIZ/scripts/reset-test-db.sh"
