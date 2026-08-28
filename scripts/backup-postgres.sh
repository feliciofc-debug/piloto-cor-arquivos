#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

BACKUP_DIR="${BACKUP_DIR:-/opt/piloto-cor/backups/postgres}"
MIN_BACKUP_BYTES="${MIN_BACKUP_BYTES:-1024}"
POSTGRES_DB="${POSTGRES_DB:-piloto_cor}"
POSTGRES_USER="${POSTGRES_USER:-postgres}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
arquivo="$BACKUP_DIR/piloto_cor_${timestamp}.dump"
temporario="$arquivo.tmp"
inicio="$(date +%s)"

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

mkdir -p "$BACKUP_DIR"

log "backup_inicio db=$POSTGRES_DB destino=$arquivo"

if ! docker compose -f "$ROOT_DIR/docker-compose.yml" exec -T db \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$temporario"; then
  rm -f "$temporario"
  log "backup_falhou etapa=pg_dump"
  exit 1
fi

tamanho="$(wc -c < "$temporario" | tr -d ' ')"
if [ "$tamanho" -lt "$MIN_BACKUP_BYTES" ]; then
  rm -f "$temporario"
  log "backup_falhou etapa=verificacao tamanho_bytes=$tamanho minimo_bytes=$MIN_BACKUP_BYTES"
  exit 1
fi

mv "$temporario" "$arquivo"

find "$BACKUP_DIR" -type f -name 'piloto_cor_*.dump' -mtime +6 -delete

fim="$(date +%s)"
duracao="$((fim - inicio))"

log "backup_ok arquivo=$arquivo tamanho_bytes=$tamanho duracao_segundos=$duracao retencao_dias=7"
