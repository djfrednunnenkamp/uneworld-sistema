#!/bin/sh
# Backup do banco de dados de produção (Postgres do compose).
#
# Faz um dump comprimido do banco para ./backups/ e apaga os mais antigos que
# RETENTION_DAYS. Roda no HOST (não dentro de um container) — usa `docker compose
# exec` para chamar o pg_dump dentro do container "db".
#
# Uso manual:
#   ./scripts/backup.sh
# Automático (cron diário às 3h, editar com `crontab -e`):
#   0 3 * * * cd /caminho/para/UneWorld && ./scripts/backup.sh >> backups/backup.log 2>&1
#
# Restaurar um backup:
#   gunzip -c backups/uneworld-AAAA-MM-DD-HHMMSS.sql.gz | \
#     docker compose -f docker-compose.prod.yml exec -T db psql -U "$DB_USER" -d "$DB_NAME"
set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
BACKUP_DIR="${BACKUP_DIR:-backups}"

# Carrega DB_USER/DB_NAME do .env (mesmos valores do compose).
if [ -f .env ]; then
  # shellcheck disable=SC1091
  . ./.env
fi
DB_USER="${DB_USER:-uneworld}"
DB_NAME="${DB_NAME:-uneworld}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d-%H%M%S)"
OUT="$BACKUP_DIR/uneworld-$STAMP.sql.gz"

echo "[$(date)] Iniciando backup de '$DB_NAME' → $OUT"
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --clean --if-exists | gzip > "$OUT"

# Falha se o dump saiu vazio/corrompido.
if [ ! -s "$OUT" ] || ! gzip -t "$OUT" 2>/dev/null; then
  echo "[$(date)] ERRO: backup vazio ou corrompido — removendo $OUT" >&2
  rm -f "$OUT"
  exit 1
fi

echo "[$(date)] Backup OK ($(du -h "$OUT" | cut -f1)). Limpando > ${RETENTION_DAYS} dias."
find "$BACKUP_DIR" -name 'uneworld-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -delete
echo "[$(date)] Concluído."
