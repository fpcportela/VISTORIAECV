-- Chamado do WhatsApp ligado ao nº da venda: quando o agendamento do chamado ganha a venda
-- (venda aberta pela agenda, ou ligada ao finalizar), o chamado passa a apontar para ela.
-- Pode rodar de novo sem problema (npm run banco:atualizar).

create or replace function trg_agenda_chamado_venda() returns trigger language plpgsql security definer as $$
begin
  if new.venda_id is not null and new.chamado_id is not null then
    update whatsapp_chamados set venda_id = new.venda_id where id = new.chamado_id and venda_id is null;
  end if;
  return null;
end $$;
drop trigger if exists trg_agenda_chamado_venda on agendamentos;
create trigger trg_agenda_chamado_venda after insert or update of venda_id, chamado_id on agendamentos
  for each row execute function trg_agenda_chamado_venda();

-- os que já existem
update whatsapp_chamados h set venda_id = a.venda_id
  from agendamentos a
 where a.chamado_id = h.id and a.venda_id is not null and h.venda_id is null;
