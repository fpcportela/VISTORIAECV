-- =====================================================================
-- Relatórios: modelos salvos (colunas, filtros e agrupamento escolhidos)
-- e faturamento de vendas de um cliente numa conta a receber (previsão).
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- Modelos de relatório de cada usuário
create table if not exists relatorio_modelos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuarios(id) on delete cascade default app_usuario_atual(),
  nome        text not null,
  fonte       text not null check (fonte in ('vendas', 'financeiro')),
  config      jsonb not null default '{}',
  criado_em   timestamptz not null default now()
);
create unique index if not exists relatorio_modelos_nome on relatorio_modelos(usuario_id, lower(nome));

-- Vendas que entraram numa conta a receber (uma venda só pode ser faturada uma vez)
create table if not exists lancamento_vendas (
  lancamento_id  uuid not null references lancamentos(id) on delete cascade,
  venda_id       uuid not null references vendas(id) on delete cascade,
  valor          numeric(12,2) not null,
  primary key (lancamento_id, venda_id)
);
create unique index if not exists lancamento_vendas_venda on lancamento_vendas(venda_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'relatorio_modelos') then
    alter table relatorio_modelos enable row level security;
    create policy relatorio_modelos_dono on relatorio_modelos for all
      using (usuario_id = app_usuario_atual()) with check (usuario_id = app_usuario_atual());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lancamento_vendas') then
    alter table lancamento_vendas enable row level security;
    create policy lancamento_vendas_por_lancamento on lancamento_vendas for all
      using (exists (select 1 from lancamentos l where l.id = lancamento_id))
      with check (exists (select 1 from lancamentos l where l.id = lancamento_id));
  end if;
end $$;

-- Se a conta a receber for cancelada, as vendas voltam a poder ser faturadas
create or replace function liberar_vendas_faturadas() returns trigger
language plpgsql security definer as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    delete from lancamento_vendas where lancamento_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_liberar_vendas_faturadas on lancamentos;
create trigger trg_liberar_vendas_faturadas after update of status on lancamentos
  for each row execute function liberar_vendas_faturadas();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on relatorio_modelos, lancamento_vendas to app_api;
  end if;
end $$;
