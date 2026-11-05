-- Agendamento CANCELADO ou FALTOU (o automático das 24 h ou marcado à mão): a venda ligada a ele é cancelada junto (a do robô, a do "Abrir venda" ou a ligada
-- pela Nova venda). Segue a mesma regra do botão Cancelar da venda: só venda ABERTA ou AGENDADO (futuro).
-- Venda aberta não tem lançamento no financeiro nem entra em royalties, então não há nada mais a desfazer.
-- Venda FINALIZADA (ou já cancelada) fica como está; a finalizada ganha um aviso no histórico.
-- Se a venda estiver ligada a outro agendamento ainda ativo, ela também fica como está.
-- Pode rodar de novo sem problema.
create or replace function trg_agenda_cancelado_venda() returns trigger language plpgsql security definer as $$
declare v vendas;
        motivo text;
begin
  if new.situacao not in ('cancelado', 'faltou') or old.situacao in ('cancelado', 'faltou') or new.venda_id is null then
    return null;
  end if;
  motivo := case when new.situacao = 'faltou' then 'Cliente faltou no agendamento' else 'Agendamento cancelado na agenda' end;
  select * into v from vendas where id = new.venda_id;
  if v.id is null then return null; end if;
  if exists (select 1 from agendamentos where venda_id = v.id and id <> new.id
                and situacao in ('agendado', 'confirmado', 'compareceu')) then
    return null;
  end if;
  if v.situacao in ('aberta', 'futuro') then
    update vendas set situacao = 'cancelada' where id = v.id;
    insert into venda_historico (venda_id, usuario_id, acao, detalhe)
    values (v.id, app_usuario_atual(), 'cancelada', motivo);
  elsif v.situacao = 'finalizada' then
    insert into venda_historico (venda_id, usuario_id, acao, detalhe)
    values (v.id, app_usuario_atual(), 'alterada', motivo || '; a venda está finalizada e não foi cancelada');
  end if;
  return null;
end $$;

drop trigger if exists trg_agenda_cancelado_venda on agendamentos;
create trigger trg_agenda_cancelado_venda after update of situacao on agendamentos
  for each row execute function trg_agenda_cancelado_venda();

-- Agendamento cancelado que volta a valer (remarcado ou situação trocada): se a venda dele foi cancelada,
-- solta a ligação para o "Abrir venda" aparecer de novo e fazer uma venda nova.
create or replace function trg_agenda_reativado_venda() returns trigger language plpgsql security definer as $$
begin
  if old.situacao = 'cancelado' and new.situacao <> 'cancelado' and new.venda_id is not null
     and exists (select 1 from vendas where id = new.venda_id and situacao = 'cancelada') then
    new.venda_id := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_agenda_reativado_venda on agendamentos;
create trigger trg_agenda_reativado_venda before update of situacao on agendamentos
  for each row execute function trg_agenda_reativado_venda();
