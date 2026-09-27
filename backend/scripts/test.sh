#!/usr/bin/env bash
#
# Corre los tests del backend.
#
# Recrea la base de test antes de correr, y eso no es opcional: la base
# prohibe el borrado fisico (db/02_logic.sql:42-61), asi que un vuelo creado por
# un test queda en la base y el test que usa el mismo codigo en la corrida
# siguiente falla con "Ya existe un vuelo con ese codigo".
#
# Uso:  scripts/test.sh [argumentos de sbt]
# Ej:   scripts/test.sh
#       scripts/test.sh "testOnly com.transport.system.services.VueloServiceSpec"
#
# Por defecto corre TODOS los specs y no "test": en sbt 2 "test" delega en
# testQuick, que es incremental y ya no corre nada cuando todo paso en la
# corrida anterior. Un script que dice "exito" sin haber ejecutado un solo test
# es peor que uno que falla.
#
# Variables de entorno:
#   AERONET_JWT_SECRET  obligatorio (lo exige Database al cargar la config)
#   AERONET_DB_URL      base de test (por defecto aeronet_test)
#   MARIADB_CLIENT      ruta al cliente mariadb
#   TEST_DB             base de test (por defecto aeronet_test)

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DB="${TEST_DB:-aeronet_test}"

if [[ -z "${AERONET_JWT_SECRET:-}" ]]; then
  echo "Falta AERONET_JWT_SECRET. Database carga la config completa al" >&2
  echo "inicializarse y no arranca sin una clave de firma." >&2
  exit 1
fi

"$RAIZ/scripts/reset-test-db.sh" >/dev/null 2>&1 || {
  echo "Falló la recreation de $TEST_DB (ver reset-test-db.sh para el detalle)" >&2
  exit 1
}
echo "==> Base $TEST_DB recreada"

AERONET_DB_URL="${AERONET_DB_URL:-jdbc:mariadb://127.0.0.1:3306/$TEST_DB}" \
  sbt -batch "${@:-testOnly *}"
