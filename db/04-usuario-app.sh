#!/bin/bash
# Cria o usuário de banco que a API usa. Ele NÃO é dono das tabelas,
# então as regras de acesso por loja (RLS) valem para ele.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_senha="$APP_DB_PASSWORD" <<'EOSQL'
create role app_api login password :'app_senha';
grant usage on schema public to app_api;
grant select, insert, update, delete on all tables in schema public to app_api;
grant usage, select on all sequences in schema public to app_api;
grant execute on all functions in schema public to app_api;
EOSQL
