#!/usr/bin/env bash
# Publica a versão mais nova no servidor.
#   ./deploy/deploy.sh            baixa do GitHub (branch DEPLOY_RAMO, padrão consulta-placa), faz backup,
#                                 gera as imagens, atualiza o banco sem perder dados e reinicia
#   ./deploy/deploy.sh --local    usa os arquivos que já estão na pasta (não baixa)
set -euo pipefail
cd "$(dirname "$0")/.."
RAIZ="$(pwd)"
COMPOSE=(docker compose -f deploy/docker-compose.yml)
[ -f deploy/.env ] || { echo "Falta deploy/.env (copie de deploy/.env.exemplo)"; exit 1; }
set -a; . deploy/.env; set +a
[ "${WHATSAPP:-}" = "sim" ] && COMPOSE+=(--profile whatsapp)
RAMO="${DEPLOY_RAMO:-consulta-placa}"

if [ "${1:-}" != "--local" ]; then
  echo "==> Baixando $RAMO"
  git fetch -q origin "$RAMO"
  ANTES=$(git rev-parse HEAD)
  git checkout -q -B "$RAMO" "origin/$RAMO"
  echo "    $ANTES -> $(git rev-parse HEAD)"
fi

# Primeira vez: banco ainda não existe, não há o que guardar
if "${COMPOSE[@]}" ps --status running --services 2>/dev/null | grep -qx banco; then
  echo "==> Backup antes de atualizar"
  ./deploy/backup-diario.sh antes-do-deploy
fi

echo "==> Gerando as imagens"
"${COMPOSE[@]}" build --pull

echo "==> Ligando o banco"
"${COMPOSE[@]}" up -d banco
# -h 127.0.0.1: na primeira vez o Postgres liga só pelo socket enquanto cria as tabelas
until "${COMPOSE[@]}" exec -T banco pg_isready -q -h 127.0.0.1 -U vistoria -d vistoria_ecv; do sleep 2; done

if [ "${WHATSAPP:-}" = "sim" ]; then
  "${COMPOSE[@]}" exec -T banco sh -c "psql -U vistoria -d vistoria_ecv -tAc \"select 1 from pg_database where datname = 'evolution'\" | grep -q 1 || createdb -U vistoria evolution"
fi

echo "==> Atualizando as regras do banco (os dados continuam)"
# Mesmos arquivos e mesma ordem do npm run banco:atualizar (scripts/atualizar.mjs --banco)
for f in $(ls db | grep -E '^(02|0[5-9]|[1-9][0-9])-.*\.sql$' | sort); do
  "${COMPOSE[@]}" exec -T -e PGOPTIONS='-c client_min_messages=warning' banco \
    psql -q -v ON_ERROR_STOP=1 -U vistoria -d vistoria_ecv -f - < "db/$f" >/dev/null || { echo "ERRO em db/$f"; exit 1; }
done

echo "==> Reiniciando"
"${COMPOSE[@]}" up -d --remove-orphans
docker image prune -f >/dev/null

for i in $(seq 1 30); do
  if curl -fsS "https://$DOMINIO/api/saude" >/dev/null 2>&1; then echo "==> No ar: https://$DOMINIO"; exit 0; fi
  sleep 2
done
echo "AVISO: https://$DOMINIO/api/saude não respondeu. Veja: ${COMPOSE[*]} logs --tail 50 api caddy"
exit 1
