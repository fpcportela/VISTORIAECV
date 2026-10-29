-- =====================================================================
-- Preço especial por cliente: cada serviço ou produto pode ter um valor diferente para o cliente.
-- Na venda (e na venda aberta pelo robô) para esse cliente, o item vem com esse valor; sem preço
-- especial, vale o preço normal do serviço.
-- Também tira a comissão de cliente e os parceiros (testados em 25 e 26/10/2026 e deixados de lado).
-- As contas já lançadas no Financeiro continuam lá.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

create table if not exists cliente_precos (
  cliente_id  uuid not null references clientes(id) on delete cascade,
  servico_id  uuid not null references servicos(id) on delete cascade,
  valor       numeric(12,2) not null check (valor >= 0),
  primary key (cliente_id, servico_id)
);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cliente_precos') then
    alter table cliente_precos enable row level security;
    create policy cliente_precos_cliente on cliente_precos for all
      using (exists (select 1 from clientes c where c.id = cliente_id))
      with check (exists (select 1 from clientes c where c.id = cliente_id));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on cliente_precos to app_api;
  end if;
end $$;

-- comissão e parceiros: sai do sistema
drop trigger if exists trg_liberar_comissoes_parceiro on lancamentos;
drop function if exists liberar_comissoes_parceiro();
drop function if exists comissao_parceiro(uuid);
drop table if exists parceiro_comissao_vendas;
drop table if exists parceiro_comissoes;
alter table vendas drop column if exists parceiro_id;
alter table clientes drop column if exists parceiro;
alter table clientes drop constraint if exists clientes_comissao;
alter table clientes drop column if exists comissao_tipo;
alter table clientes drop column if exists comissao_valor;
alter table lancamento_vendas drop column if exists comissao;
