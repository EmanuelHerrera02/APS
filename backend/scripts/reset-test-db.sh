#!/usr/bin/env bash
#
# Recrea la base de test desde cero.
#
# Hace falta porque la base de producción prohíbe el borrado físico con triggers
# (db/02_logic.sql:42-61): un vuelo creado por un test no se puede borrar
# después, ni sus salidas, ni sus clases. La única forma de que los tests sean
# repetibles es empezar siempre de una base recién cargada.
#
# Los tres scripts de db/ hacen USE aeronet, así que se reescribe el nombre al
# volcarlos en el cliente.
#
# Uso:  scripts/reset-test-db.sh
#
# Variables de entorno opcionales:
#   MARIADB_CLIENT  ruta al cliente mariadb (por defecto busca mariadb en PATH)
#   DB_HOST, DB_PORT, DB_USER, DB_PASSWORD  conexión al servidor
#   TEST_DB         nombre de la base de test (por defecto aeronet_test)
#   APP_DB_USER     usuario de la app, a quien se le da acceso (aeronet_app)
#   APP_DB_PASSWORD su contraseña, solo para el GRANT

set -euo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DB_DIR="$RAIZ/db"
TEST_DB="${TEST_DB:-aeronet_test}"

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_PASSWORD="${DB_PASSWORD:-}"

# Cliente: el del sistema, o el que se pase por MARIADB_CLIENT.
if [[ -n "${MARIADB_CLIENT:-}" ]]; then
  CLIENT="$MARIADB_CLIENT"
elif command -v mariadb >/dev/null 2>&1; then
  CLIENT="$(command -v mariadb)"
elif command -v mysql >/dev/null 2>&1; then
  CLIENT="$(command -v mysql)"
else
  echo "No se encontro el cliente mariadb. Setear MARIADB_CLIENT." >&2
  exit 1
fi

MYSQL_ARGS=(--host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --default-character-set=utf8mb4)
if [[ -n "$DB_PASSWORD" ]]; then
  MYSQL_ARGS+=(--password="$DB_PASSWORD")
else
  MYSQL_ARGS+=(--skip-password)
fi

echo "==> Recreando $TEST_DB"
"$CLIENT" "${MYSQL_ARGS[@]}" -e "DROP DATABASE IF EXISTS \`$TEST_DB\`;
  CREATE DATABASE \`$TEST_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"

# El backend conecta con su propio usuario, que por defecto solo tiene acceso a
# la base de desarrollo. Sin este GRANT los tests fallan al conectar.
APP_DB_USER="${APP_DB_USER:-aeronet_app}"
APP_DB_PASSWORD="${APP_DB_PASSWORD:-aeronet_app_dev}"
echo "==> Dando acceso a $APP_DB_USER"
"$CLIENT" "${MYSQL_ARGS[@]}" -e "CREATE USER IF NOT EXISTS '$APP_DB_USER'@'localhost' IDENTIFIED BY '$APP_DB_PASSWORD';
  CREATE USER IF NOT EXISTS '$APP_DB_USER'@'127.0.0.1' IDENTIFIED BY '$APP_DB_PASSWORD';
  GRANT ALL PRIVILEGES ON \`$TEST_DB\`.* TO '$APP_DB_USER'@'localhost';
  GRANT ALL PRIVILEGES ON \`$TEST_DB\`.* TO '$APP_DB_USER'@'127.0.0.1';
  FLUSH PRIVILEGES;"

for archivo in 01_schema.sql 02_logic.sql 03_seed.sql; do
  echo "==> Cargando db/$archivo"
  # El seed llama a crear_compra(), que hoy falla por un mix de collations
  # (JSON_TABLE arma sus VARCHAR en utf8mb4_general_ci y se comparan contra un
  # ENUM en utf8mb4_unicode_ci). Es un bug conocido y ajeno al alta de vuelo, que
  # no usa JSON_TABLE, asi que se deja --force solo aca para que el resto del
  # seed cargue. En 01 y 02 un error es real y hay que que corte.
  if [[ "$archivo" == "03_seed.sql" ]]; then
    EXTRA=(--force)
  else
    EXTRA=()
  fi

  # USE aeronet / CREATE DATABASE ... aeronet -> la base de test.
  sed -e "s/\bUSE aeronet\b/USE \`$TEST_DB\`/g" \
      -e "s/CREATE DATABASE IF NOT EXISTS aeronet/CREATE DATABASE IF NOT EXISTS \`$TEST_DB\`/g" \
      "$DB_DIR/$archivo" | "$CLIENT" "${MYSQL_ARGS[@]}" "${EXTRA[@]}" "$TEST_DB"
done

echo "==> Listo: $TEST_DB"
echo
echo "Para correr los tests:"
echo "  AERONET_DB_URL='jdbc:mariadb://$DB_HOST:$DB_PORT/$TEST_DB' \\"
echo "  AERONET_JWT_SECRET=... sbt test"
