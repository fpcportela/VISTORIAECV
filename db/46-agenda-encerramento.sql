-- Agenda: placa vem da venda; FALTOU automático; robô para quando o cliente não confirmou até a hora.
-- Pode rodar de novo sem problema (npm run banco:atualizar).

-- Agendamento sem placa: quando ganha a venda (ou a venda ganha veículo), usa a placa da venda
create or replace function app_agenda_placa_da_venda(p_venda uuid) returns void
language sql security definer as $$
  update agendamentos a
     set placa = (select upper(e.placa) from venda_itens i join veiculos e on e.id = i.veiculo_id
                   where i.venda_id = p_venda and coalesce(e.placa, '') <> '' order by i.ctid limit 1),
         atualizado_em = now()
   where a.venda_id = p_venda and coalesce(a.placa, '') = ''
     and exists (select 1 from venda_itens i join veiculos e on e.id = i.veiculo_id where i.venda_id = p_venda and coalesce(e.placa, '') <> '')
$$;

create or replace function trg_agenda_placa_venda() returns trigger language plpgsql security definer as $$
begin
  if tg_table_name = 'agendamentos' then
    if new.venda_id is not null and coalesce(new.placa, '') = '' then perform app_agenda_placa_da_venda(new.venda_id); end if;
  elsif new.veiculo_id is not null then
    perform app_agenda_placa_da_venda(new.venda_id);
  end if;
  return null;
end $$;
drop trigger if exists trg_agenda_placa_venda on agendamentos;
create trigger trg_agenda_placa_venda after insert or update of venda_id on agendamentos
  for each row execute function trg_agenda_placa_venda();
drop trigger if exists trg_venda_itens_placa_agenda on venda_itens;
create trigger trg_venda_itens_placa_agenda after insert or update of veiculo_id on venda_itens
  for each row execute function trg_agenda_placa_venda();

-- Rotina (roda a cada poucos minutos pela API):
--  1) cliente não respondeu a confirmação até a hora do agendamento: para a pergunta e o robô do chamado
--  2) 24 h depois do horário, agendamento que não virou venda vira FALTOU
create or replace function app_agenda_rotina() returns void
language plpgsql security definer as $$
begin
  update whatsapp_chamados h set robo_estado = 'humano', atualizado_em = now()
    from agendamentos a
   where a.confirmacao_etapa is not null and a.inicio <= now() and a.chamado_id = h.id
     and coalesce(h.robo_estado, 'coletando') <> 'humano';
  update agendamentos set confirmacao_etapa = null, confirmacao_dados = null
   where confirmacao_etapa is not null and inicio <= now();
  update agendamentos set situacao = 'faltou', atualizado_em = now()
   where situacao in ('agendado', 'confirmado') and venda_id is null and inicio < now() - interval '24 hours';
end $$;

-- os que já passaram
select app_agenda_placa_da_venda(v.id) from (select distinct venda_id as id from agendamentos where venda_id is not null and coalesce(placa, '') = '') v;
select app_agenda_rotina();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_agenda_rotina(), app_agenda_placa_da_venda(uuid) to app_api;
  end if;
end $$;
