-- Agendamento CANCELADO: o chamado do WhatsApp dele é encerrado (vai para a coluna que conclui, como o botão Encerrar)
-- e a pergunta de confirmação pendente é descartada. Pode rodar de novo sem problema.
create or replace function trg_agenda_cancelado_chamado() returns trigger language plpgsql security definer as $$
declare col uuid;
        ch uuid;
begin
  if new.situacao <> 'cancelado' or old.situacao = 'cancelado' then return null; end if;
  update agendamentos set confirmacao_etapa = null, confirmacao_dados = null where id = new.id and confirmacao_etapa is not null;
  ch := coalesce(new.chamado_id, app_agendamento_chamado(new.id));
  if ch is null then return null; end if;
  select c.id into col from whatsapp_colunas c join whatsapp_chamados h on h.empresa_id = c.empresa_id
   where h.id = ch and c.finaliza order by c.ordem limit 1;
  if col is null then return null; end if;
  update whatsapp_chamados set coluna_id = col, aberto = false, concluido_em = now(), atualizado_em = now(),
         titulo = coalesce(titulo, 'AGENDAMENTO CANCELADO')
   where id = ch and aberto;
  return null;
end $$;

-- Chamado aberto do agendamento (o ligado a ele, ou o do mesmo celular)
create or replace function app_agendamento_chamado(p_ag uuid) returns uuid
language sql stable security definer as $$
  select h.id from agendamentos a
    join whatsapp_contatos k on k.empresa_id = a.empresa_id and tel_chave(k.telefone) = tel_chave(a.telefone)
    join whatsapp_chamados h on h.contato_id = k.id and h.aberto
   where a.id = p_ag and coalesce(a.telefone, '') <> ''
   order by h.criado_em desc limit 1
$$;

drop trigger if exists trg_agenda_cancelado_chamado on agendamentos;
create trigger trg_agenda_cancelado_chamado after update of situacao on agendamentos
  for each row execute function trg_agenda_cancelado_chamado();
