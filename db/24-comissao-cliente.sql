-- =====================================================================
-- Comissão do cliente: valor fixo por venda ou porcentagem do total da venda.
-- O Faturar cliente usa a comissão para montar a conta a receber.
-- A empresa de um grupo sem comissão própria usa a do grupo.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

alter table clientes add column if not exists comissao_tipo text;
alter table clientes add column if not exists comissao_valor numeric(12, 2);
alter table clientes drop constraint if exists clientes_comissao;
alter table clientes add constraint clientes_comissao check (
  (comissao_tipo is null and comissao_valor is null)
  or (comissao_tipo = 'fixo' and comissao_valor >= 0)
  or (comissao_tipo = 'percentual' and comissao_valor >= 0 and comissao_valor <= 100));

-- O que foi faturado: a comissão ou o valor que faltava receber da venda
alter table lancamento_vendas add column if not exists comissao boolean not null default false;
