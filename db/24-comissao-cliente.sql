-- =====================================================================
-- Comissão do cliente: valor fixo por venda ou porcentagem do total da venda.
-- Substituída pela comissão do parceiro por serviço (db/25-parceiros.sql), que copia estes valores.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

alter table clientes add column if not exists comissao_tipo text;
alter table clientes add column if not exists comissao_valor numeric(12, 2);
alter table clientes drop constraint if exists clientes_comissao;
alter table clientes add constraint clientes_comissao check (
  (comissao_tipo is null and comissao_valor is null)
  or (comissao_tipo = 'fixo' and comissao_valor >= 0)
  or (comissao_tipo = 'percentual' and comissao_valor >= 0 and comissao_valor <= 100));
