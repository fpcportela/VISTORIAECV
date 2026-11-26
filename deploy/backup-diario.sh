#!/usr/bin/env bash
# Backup do banco (pg_dump, mesmo formato do botão Configurações → Backup).
# Guarda em deploy/backups, apaga os mais velhos que BACKUP_DIAS e, se RCLONE_DESTINO estiver
# no deploy/.env, manda uma cópia para fora do servidor (Google Drive).
# Cron (todo dia às 3h):  0 3 * * * /opt/vistoria-ecv/deploy/backup-diario.sh >> /opt/vistoria-ecv/deploy/backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . deploy/.env; set +a
PASTA=deploy/backups
mkdir -p "$PASTA"
chmod 700 "$PASTA"
ROTULO="${1:-diario}"
ARQ="$PASTA/vistoria-ecv_${ROTULO}_$(date +%d-%m-%Y_%Hh%Mm%Ss).dump"
docker compose -f deploy/docker-compose.yml exec -T banco pg_dump -U vistoria -Fc vistoria_ecv > "$ARQ.tmp"
mv "$ARQ.tmp" "$ARQ"
echo "$(date '+%F %T') backup $ARQ ($(du -h "$ARQ" | cut -f1))"
find "$PASTA" -name '*.dump' -mtime +"${BACKUP_DIAS:-14}" -delete
if [ -n "${RCLONE_DESTINO:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$ARQ" "$RCLONE_DESTINO" && echo "    copiado para $RCLONE_DESTINO"
fi
