-- =====================================================================
-- WhatsApp: a filial escolhida no topo da tela vale também para as conversas.
--   * Filial escolhida (X-Loja / loja_ativa()): só as conversas e os chamados dessa filial,
--     inclusive para o master.
--   * "Todas as lojas": tudo o que a pessoa vê (as conexões liberadas para ela, db/54).
-- De qual filial é a conversa:
--   1. conexão de uma unidade: a unidade da conexão;
--   2. conexão do grupo todo: a unidade do atendimento (a que o cliente escolheu no robô,
--      senão a do agendamento, senão a da venda do chamado);
--   3. conversa do grupo todo que ainda não tem unidade (cliente que acabou de escrever e
--      ainda não escolheu): aparece em todas as filiais, para ninguém perder a mensagem.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- Unidade da conversa (nula = conversa do grupo todo ainda sem unidade)
create or replace function whatsapp_contato_loja(p_contato uuid) returns uuid
language sql stable security definer as $$
  select coalesce(
    (select n.loja_id from whatsapp_contatos k join whatsapp_numeros n on n.id = k.numero_id where k.id = p_contato),
    (select coalesce(
              (select l.id from lojas l where l.id::text = h.robo_dados->>'loja_id'),
              (select a.loja_id from agendamentos a where a.id = app_agendamento_do_chamado(h.id)),
              (select v.loja_id from vendas v where v.id = h.venda_id))
       from whatsapp_chamados h
      where h.contato_id = p_contato
      order by h.aberto desc, h.criado_em desc
      limit 1))
$$;

-- A conversa entra na filial escolhida no topo? (sem filial escolhida: sempre)
create or replace function whatsapp_na_filial(p_contato uuid) returns boolean
language sql stable security definer as $$
  select loja_ativa() is null or coalesce(whatsapp_contato_loja(p_contato) = loja_ativa(), true)
$$;

-- A pessoa logada vê a conversa: a conexão liberada para ela (db/54) e a filial do topo
create or replace function ve_conversa(p_contato uuid, p_permissao text default 'whatsapp.ver') returns boolean
language sql stable security definer as $$
  select coalesce((select ve_whatsapp(k.numero_id, k.empresa_id, p_permissao) and whatsapp_na_filial(k.id)
                     from whatsapp_contatos k where k.id = p_contato), false)
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function whatsapp_contato_loja(uuid), whatsapp_na_filial(uuid), ve_conversa(uuid, text) to app_api;
  end if;
end $$;
