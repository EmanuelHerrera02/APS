#!/usr/bin/env bash
#
# Levanta el MariaDB de desarrollo.
#
# Vive en /tmp/opencode/mdb, una instalación descomprimida a mano: no hay paquete
# del sistema ni init script, porque en esta máquina no hay Docker. La
# consecuencia es que se pierde si se reinicia la máquina o el sistema limpia
# /tmp, y en ese caso hay que reconstruir con scripts/db-reset.sh.
#
# Los flags no son cosméticos:
#   --collation-server     tiene que ser utf8mb4_unicode_ci, que es con la que
#                          se creó el schema. Con otra, los CHECK y los ENUM
#                          comparan distinto y los errores salen con mensajes
#                          que no corresponden al problema real.
#   --default-time-zone    -03:00, igual que el backend (application.conf). La
#                          base y el servidor tienen que estar en el mismo
#                          huso o las fechas de vuelo se corren un día.
#   --event-scheduler      lo usa el procedure de mantenimiento de la base.
#
# Uso:
#   scripts/db-up.sh              # levanta y espera a que responda
#   scripts/db-up.sh --status     # solo informa si está o no

set -euo pipefail

MARIADB_HOME="${MARIADB_HOME:-/tmp/opencode/mdb}"
DATADIR="$MARIADB_HOME/data"
SOCKET="$MARIADB_HOME/run/mysqld.sock"
PORT="${DB_PORT:-3306}"

# Ojo: --collation-server y --default-time-zone son un problema conocido del
# repo, no una preferencia. Ver db/02_logic.sql:585, que mezcla dos collations
# y hace fallar 7 de los INSERT del seed (compras).

cliente() {
  if [[ -x "$MARIADB_HOME/usr/bin/mariadb" ]]; then
    echo "$MARIADB_HOME/usr/bin/mariadb"
  elif command -v mariadb >/dev/null 2>&1; then
    command -v mariadb
  else
    echo "No se encontró el cliente mariadb." >&2
    exit 1
  fi
}

esta_viva() {
  "$(cliente)" --socket="$SOCKET" --user=root -e "SELECT 1" >/dev/null 2>&1
}

if [[ "${1:-}" == "--status" ]]; then
  if esta_viva; then
    echo "MariaDB arriba en $SOCKET (puerto $PORT)"
    exit 0
  else
    echo "MariaDB abajo"
    exit 1
  fi
fi

if esta_viva; then
  echo "==> MariaDB ya está arriba en $SOCKET"
  exit 0
fi

if [[ ! -d "$MARIADB_HOME/usr/sbin" ]]; then
  cat >&2 <<EOF
No existe $MARIADB_HOME/usr/sbin: la instalación de MariaDB ya no está.

Vivía en /tmp, así que el sistema la habrá borrado. Reconstruí la base con:

  MARIADB_CLIENT=<ruta-al-cliente> TEST_DB=aeronet scripts/db-reset.sh

y volvé a correr este script. Si además se perdió el cliente, hay que volver a
instalar MariaDB como paquete del sistema (eso sí requiere sudo).
EOF
  exit 1
fi

if [[ ! -d "$DATADIR/mysql" ]]; then
  cat >&2 <<EOF
El datadir $DATADIR está vacío o incompleto.

No se puede arrancar sin él. Recreá la base con:

  TEST_DB=aeronet scripts/db-reset.sh
EOF
  exit 1
fi

mkdir -p "$MARIADB_HOME/run"

echo "==> Levantando MariaDB desde $MARIADB_HOME"
# setsid + nohup para que sobreviva al cierre de la terminal, que es lo que
# hace que la base se caiga a mitad de una sesión de trabajo.
setsid nohup "$MARIADB_HOME/usr/sbin/mariadbd" \
  --basedir="$MARIADB_HOME/usr" \
  --datadir="$DATADIR" \
  --port="$PORT" \
  --bind-address=127.0.0.1 \
  --socket="$SOCKET" \
  --pid-file="$MARIADB_HOME/run/mysqld.pid" \
  --character-set-server=utf8mb4 \
  --collation-server=utf8mb4_unicode_ci \
  --default-time-zone=-03:00 \
  --event-scheduler=ON \
  --user="$(id -un)" \
  --skip-name-resolve \
  > "$MARIADB_HOME/mariadbd.log" 2>&1 < /dev/null &

# El arranque no es instantáneo: primero abre el socket y recién después acepta
# consultas. Con 30 intentos de 1s alcanza de sobra y evita el "wait for it"
# que no viene en este shell.
for _ in $(seq 1 30); do
  if esta_viva; then
    echo "==> MariaDB arriba en $SOCKET (puerto $PORT)"
    exit 0
  fi
  sleep 1
done

echo "MariaDB no respondió en 30s. Log:" >&2
tail -20 "$MARIADB_HOME/mariadbd.log" >&2
exit 1
