-- =====================================================================
-- Toda venda finalizada entra no Financeiro: uma conta a receber por pagamento.
--   dinheiro                  -> já entra RECEBIDA (baixa no caixa da loja)
--   cartão crédito/débito     -> em aberto até a conciliação (ou baixa manual)
--   PIX / transferência / boleto -> em aberto para baixa manual ou conciliação
--   faturado                  -> não entra aqui: vai pelo Relatórios > Faturar cliente
-- Lançamento da venda apagado ou cancelado no Financeiro: a venda volta para ABERTA,
-- com "Lançamento foi removido do financeiro - ajustar recebimento" no histórico.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

alter table lancamentos add column if not exists origem text;   -- 'venda' = criado sozinho pela venda
create index if not exists lancamentos_venda on lancamentos(venda_id) where venda_id is not null;

-- Caixa da loja (cria um se ainda não houver)
create or replace function app_caixa_da_loja(p_loja uuid) returns uuid
language plpgsql security definer as $$
declare c uuid;
begin
  select id into c from contas_financeiras where loja_id = p_loja and tipo = 'caixa' and ativo order by criado_em limit 1;
  if c is null then
    insert into contas_financeiras (loja_id, tipo, nome)
    select p_loja, 'caixa', 'CAIXA ' || upper(nome) from lojas where id = p_loja returning id into c;
  end if;
  return c;
end $$;

-- Cria as contas a receber que faltam para os pagamentos da venda finalizada
create or replace function app_venda_financeiro(p_venda uuid) returns void
language plpgsql security definer as $$
declare v vendas;
        v_cliente text;
        v_cat uuid;
        v_centro uuid;
        p record;
        v_ja numeric(12,2);
        v_lanc uuid;
        v_venc date;
        rotulo text;
begin
  select * into v from vendas where id = p_venda;
  if v.id is null or v.situacao <> 'finalizada' then return; end if;
  select nome into v_cliente from clientes where id = v.cliente_id;
  -- categoria de receita: a da venda; senão a de vistoria/serviços; senão a primeira
  select c.id into v_cat from categorias_financeiras c
   where c.empresa_id = v.empresa_id and c.tipo = 'receber' and not c.grupo and c.ativo
   order by (c.id = v.categoria_id) desc, (c.nome ~* 'vistori|servi') desc, c.codigo nulls last, c.nome limit 1;
  select id into v_centro from centros_custo where empresa_id = v.empresa_id and loja_id = v.loja_id and ativo order by criado_em limit 1;

  for p in
    select vp.*, row_number() over (partition by vp.forma order by vp.criado_em, vp.id) as n
      from venda_pagamentos vp where vp.venda_id = v.id and vp.forma <> 'faturado' order by vp.criado_em, vp.id
  loop
    -- o que já está no financeiro desta forma (ex.: recebido antes de a venda ser reaberta) não entra de novo
    select coalesce(sum(valor), 0) - coalesce((select sum(x.valor) from venda_pagamentos x
                                                 where x.venda_id = v.id and x.forma = p.forma
                                                   and (x.criado_em, x.id) < (p.criado_em, p.id)), 0)
      into v_ja
      from lancamentos where venda_id = v.id and origem = 'venda' and forma_pagamento = p.forma and status <> 'cancelado';
    continue when v_ja >= p.valor - 0.005;
    v_ja := greatest(v_ja, 0);
    rotulo := case p.forma when 'dinheiro' then 'DINHEIRO' when 'pix' then 'PIX' when 'cartao_credito' then 'CARTÃO CRÉDITO'
                           when 'cartao_debito' then 'CARTÃO DÉBITO' when 'boleto' then 'BOLETO' when 'transferencia' then 'TRANSFERÊNCIA'
                           else upper(p.forma::text) end;
    v_venc := p.data_pagamento + case p.forma when 'cartao_credito' then 30 when 'cartao_debito' then 1 else 0 end;
    insert into lancamentos (loja_id, tipo, categoria_id, centro_custo_id, cliente_id, venda_id, origem, descricao, competencia,
                             vencimento, valor, forma_pagamento, documento, observacoes, criado_por)
    values (v.loja_id, 'receber', v_cat, v_centro, v.cliente_id, v.id, 'venda',
            'VENDA Nº ' || v.numero || ' - ' || coalesce(v_cliente, ''), date_trunc('month', v.data_venda)::date,
            v_venc, p.valor - v_ja, p.forma, nullif(p.cv, ''),
            concat_ws(' · ', rotulo, nullif(p.bandeira, ''), nullif(p.detalhe, '')), coalesce(v.finalizada_por, app_usuario_atual()))
    returning id into v_lanc;
    if p.forma = 'dinheiro' then
      insert into lancamento_baixas (lancamento_id, data, valor, forma_pagamento, conta_id, criado_por)
      values (v_lanc, p.data_pagamento, p.valor - v_ja, 'dinheiro', app_caixa_da_loja(v.loja_id), coalesce(v.finalizada_por, app_usuario_atual()));
      update lancamentos set conta_id = (select conta_id from lancamento_baixas where lancamento_id = v_lanc limit 1) where id = v_lanc;
    end if;
  end loop;
end $$;

-- Venda reaberta: tira do financeiro o que ainda não foi recebido de verdade (em aberto, e o dinheiro,
-- que entrou sozinho). Ao finalizar de novo, os pagamentos corrigidos entram outra vez.
create or replace function app_venda_financeiro_reaberta(p_venda uuid) returns void
language plpgsql security definer as $$
begin
  perform set_config('app.venda_fin_sync', '1', true);
  delete from lancamentos
   where venda_id = p_venda and origem = 'venda'
     and id::text <> coalesce(current_setting('app.lanc_removido', true), '')
     and (valor_pago = 0 or forma_pagamento = 'dinheiro');
  perform set_config('app.venda_fin_sync', '', true);
end $$;

create or replace function trg_venda_financeiro() returns trigger language plpgsql security definer as $$
begin
  if new.situacao = 'finalizada' and (tg_op = 'INSERT' or old.situacao is distinct from 'finalizada') then
    perform app_venda_financeiro(new.id);
  elsif tg_op = 'UPDATE' and old.situacao = 'finalizada' and new.situacao <> 'finalizada' then
    perform app_venda_financeiro_reaberta(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_venda_financeiro on vendas;
create trigger trg_venda_financeiro after insert or update of situacao on vendas
  for each row execute function trg_venda_financeiro();

-- Lançamento de venda apagado ou cancelado no Financeiro: a venda volta para ABERTA, com o aviso no histórico.
-- Vale também para a fatura do "Faturar cliente" (as vendas dela podem ser faturadas de novo).
create or replace function app_lancamento_removido(p_lanc uuid, p_venda uuid) returns void
language plpgsql security definer as $$
declare r record;
begin
  if coalesce(current_setting('app.venda_fin_sync', true), '') = '1' then return; end if;
  perform set_config('app.lanc_removido', p_lanc::text, true);
  for r in
    select v.id, v.situacao from vendas v
     where v.id = p_venda or v.id in (select venda_id from lancamento_vendas where lancamento_id = p_lanc)
  loop
    if r.situacao = 'finalizada' then
      perform set_config('app.reabrindo_venda', r.id::text, true);
      update vendas set situacao = 'aberta', finalizada_em = null, finalizada_por = null where id = r.id;
      perform set_config('app.reabrindo_venda', '', true);
    end if;
    insert into venda_historico (venda_id, usuario_id, acao, detalhe)
    values (r.id, app_usuario_atual(), case when r.situacao = 'finalizada' then 'reaberta' else 'alterada' end,
            'Lançamento foi removido do financeiro - ajustar recebimento');
  end loop;
  perform set_config('app.lanc_removido', '', true);
end $$;

create or replace function trg_lancamento_removido() returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'DELETE' then
    if old.tipo = 'receber' then perform app_lancamento_removido(old.id, case when old.origem = 'venda' then old.venda_id end); end if;
    return old;
  end if;
  if new.status = 'cancelado' and old.status <> 'cancelado' and new.tipo = 'receber' then
    perform app_lancamento_removido(new.id, case when new.origem = 'venda' then new.venda_id end);
    delete from lancamento_vendas where lancamento_id = new.id;   -- fatura cancelada: as vendas podem ser faturadas de novo
  end if;
  return new;
end $$;
drop trigger if exists trg_lancamento_removido on lancamentos;
create trigger trg_lancamento_removido before delete on lancamentos
  for each row execute function trg_lancamento_removido();
drop trigger if exists trg_lancamento_cancelado on lancamentos;
create trigger trg_lancamento_cancelado after update of status on lancamentos
  for each row execute function trg_lancamento_removido();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_venda_financeiro(uuid), app_caixa_da_loja(uuid) to app_api;
  end if;
end $$;

-- Vendas já finalizadas que ainda não estão no financeiro
select app_venda_financeiro(v.id) from vendas v where v.situacao = 'finalizada';
