#!/usr/bin/env bash
# Coloca um backup (.dump) no banco do servidor, APAGANDO os dados atuais.
# Usado na virada (dados do Mac) ou para voltar um backup.
#   ./deploy/restaurar.sh caminho/do/arquivo.dump
set -euo pipefail
cd "$(dirname "$0")/.."
ARQ="${1:?Informe o arquivo .dump}"
[ -f "$ARQ" ] || { echo "Arquivo não encontrado: $ARQ"; exit 1; }
COMPOSE=(docker compose -f deploy/docker-compose.yml)
read -r -p "Isso APAGA os dados atuais do servidor e coloca os de $ARQ. Digite SIM para continuar: " ok
[ "$ok" = "SIM" ] || { echo "Cancelado."; exit 1; }
if "${COMPOSE[@]}" exec -T banco pg_isready -q -U vistoria -d vistoria_ecv; then
  ./deploy/backup-diario.sh antes-de-restaurar || true
fi
"${COMPOSE[@]}" stop api
"${COMPOSE[@]}" exec -T banco pg_restore -U vistoria -d vistoria_ecv --clean --if-exists --no-owner --single-transaction < "$ARQ"
echo "==> Dados restaurados. Atualizando as regras do banco e religando a API"
./deploy/deploy.sh --local
