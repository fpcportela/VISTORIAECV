-- Situação do agendamento move o chamado do WhatsApp no quadro:
--   agendado (ainda não confirmado) -> coluna CONFIRMAR
--   confirmado (cliente disse SIM ou alguém marcou na agenda) -> coluna AGENDADO(S)
--   compareceu -> coluna que conclui (db/36)
-- A coluna é achada pelo começo do nome (sem acento); se o grupo não tiver a coluna, nada muda.
-- O agendamento feito na agenda já escolhe a coluna na hora (janela "Chamado no WhatsApp"); só as
-- mudanças de situação depois disso movem o chamado.

create or replace function app_agenda_mover_chamado(p_ag uuid, p_coluna text) returns void
language plpgsql security definer as $$
declare a agendamentos;
        col uuid;
begin
  select * into a from agendamentos where id = p_ag;
  if a.id is null then return; end if;
  select c.id into col from whatsapp_colunas c
   where c.empresa_id = a.empresa_id and not c.finaliza
     and translate(upper(trim(c.nome)), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC') like p_coluna || '%'
   order by c.ordem limit 1;
  if col is null then return; end if;
  update whatsapp_chamados h
     set coluna_id = col, atualizado_em = now(),
         ordem = coalesce((select min(ordem) from whatsapp_chamados where coluna_id = col), 1) - 1
   where h.aberto and h.empresa_id = a.empresa_id and h.coluna_id <> col
     and (h.id = a.chamado_id
          or (a.chamado_id is null and h.contato_id in (select k.id from whatsapp_contatos k
                                                        where k.empresa_id = a.empresa_id and tel_chave(k.telefone) = tel_chave(a.telefone))));
end $$;

create or replace function trg_agenda_coluna_chamado() returns trigger language plpgsql security definer as $$
begin
  -- inserido já ligado a um chamado (o robô agendou) ou mudou de situação
  if tg_op = 'INSERT' and new.chamado_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.situacao is not distinct from new.situacao then return null; end if;
  if new.situacao = 'agendado' then perform app_agenda_mover_chamado(new.id, 'CONFIRMAR');
  elsif new.situacao = 'confirmado' then perform app_agenda_mover_chamado(new.id, 'AGENDADO');
  end if;
  return null;
end $$;
drop trigger if exists trg_agenda_coluna_chamado on agendamentos;
create trigger trg_agenda_coluna_chamado after insert or update of situacao on agendamentos
  for each row execute function trg_agenda_coluna_chamado();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_agenda_mover_chamado(uuid, text) to app_api;
  end if;
end $$;
