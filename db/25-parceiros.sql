-- =====================================================================
-- Parceiros: cliente (PF ou PJ) que indica clientes para a loja, como uma revenda de carros.
-- A venda guarda o parceiro que indicou; a loja paga ao parceiro uma comissão por serviço
-- (valor fixo ou % do serviço), lançada como conta a pagar no Financeiro.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

alter table clientes add column if not exists parceiro boolean not null default false;

-- Comissão do parceiro por serviço; servico_id vazio = os demais serviços
create table if not exists parceiro_comissoes (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references clientes(id) on delete cascade,
  servico_id  uuid references servicos(id) on delete cascade,
  tipo        text not null check (tipo in ('fixo', 'percentual')),
  valor       numeric(12,2) not null check (valor >= 0 and (tipo = 'fixo' or valor <= 100))
);
create unique index if not exists parceiro_comissoes_servico
  on parceiro_comissoes(cliente_id, coalesce(servico_id, '00000000-0000-0000-0000-000000000000'));

-- A comissão única por cliente (db/24) vira a regra "demais serviços" do parceiro
insert into parceiro_comissoes (cliente_id, servico_id, tipo, valor)
select id, null, comissao_tipo, comissao_valor from clientes where comissao_tipo is not null
on conflict do nothing;
update clientes set parceiro = true where comissao_tipo is not null and not parceiro;
update clientes set comissao_tipo = null, comissao_valor = null where comissao_tipo is not null;

alter table lancamento_vendas drop column if exists comissao;

-- Quem indicou a venda
alter table vendas add column if not exists parceiro_id uuid references clientes(id);
create index if not exists vendas_parceiro on vendas(parceiro_id) where parceiro_id is not null;

-- Vendas cuja comissão entrou numa conta a pagar ao parceiro (uma vez por venda)
create table if not exists parceiro_comissao_vendas (
  lancamento_id  uuid not null references lancamentos(id) on delete cascade,
  venda_id       uuid not null references vendas(id) on delete cascade,
  valor          numeric(12,2) not null,
  primary key (lancamento_id, venda_id)
);
create unique index if not exists parceiro_comissao_vendas_venda on parceiro_comissao_vendas(venda_id);

-- Comissão de uma venda: soma, item a item, da regra do parceiro para o serviço (ou a dos demais).
-- Porcentagem sobre o valor do item já com o desconto da venda (proporcional).
create or replace function comissao_parceiro(p_venda uuid) returns numeric
language sql stable as $$
  select round(sum(
           case r.tipo when 'fixo' then r.valor * i.quantidade
                       else i.valor_total * (case when v.valor_bruto > 0 then v.valor_total / v.valor_bruto else 1 end) * r.valor / 100 end
         ), 2)
    from vendas v
    join venda_itens i on i.venda_id = v.id
    join lateral (select pc.tipo, pc.valor from parceiro_comissoes pc
                   where pc.cliente_id = v.parceiro_id and (pc.servico_id = i.servico_id or pc.servico_id is null)
                   order by pc.servico_id nulls last limit 1) r on true
   where v.id = p_venda and v.parceiro_id is not null
$$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'parceiro_comissoes') then
    alter table parceiro_comissoes enable row level security;
    create policy parceiro_comissoes_cliente on parceiro_comissoes for all
      using (exists (select 1 from clientes c where c.id = cliente_id))
      with check (exists (select 1 from clientes c where c.id = cliente_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'parceiro_comissao_vendas') then
    alter table parceiro_comissao_vendas enable row level security;
    create policy parceiro_comissao_vendas_lancamento on parceiro_comissao_vendas for all
      using (exists (select 1 from lancamentos l where l.id = lancamento_id))
      with check (exists (select 1 from lancamentos l where l.id = lancamento_id));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on parceiro_comissoes, parceiro_comissao_vendas to app_api;
  end if;
end $$;

-- Conta a pagar cancelada: as vendas voltam para o relatório do parceiro
create or replace function liberar_comissoes_parceiro() returns trigger
language plpgsql security definer as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    delete from parceiro_comissao_vendas where lancamento_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_liberar_comissoes_parceiro on lancamentos;
create trigger trg_liberar_comissoes_parceiro after update of status on lancamentos
  for each row execute function liberar_comissoes_parceiro();

-- Categoria de despesa para a comissão (em "Franquia e comercial"), onde ainda não houver
insert into categorias_financeiras (empresa_id, codigo, nome, tipo, grupo, pai_id)
select g.empresa_id, g.codigo || '.' || lpad((coalesce((select max(split_part(f.codigo, '.', 2)::int) from categorias_financeiras f
                                                        where f.pai_id = g.id and f.codigo ~ '^\d+\.\d+$'), 0) + 1)::text, 2, '0'),
       'Comissões de parceiros', 'pagar', false, g.id
  from categorias_financeiras g
 where g.grupo and g.tipo = 'pagar' and g.nome = 'Franquia e comercial'
   and not exists (select 1 from categorias_financeiras c where c.empresa_id = g.empresa_id and c.tipo = 'pagar' and c.nome ilike 'comiss%');
