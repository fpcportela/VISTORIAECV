-- Sem a coluna CONFIRMAR: agendado (pelo robô ou pela agenda) e confirmado levam o chamado para AGENDADO.
-- A confirmação o próprio robô pergunta logo depois do pedido (SIM: manda endereço + Waze e marca CONFIRMADO).
-- Pode rodar de novo sem problema (npm run banco:atualizar).

create or replace function trg_agenda_coluna_chamado() returns trigger language plpgsql security definer as $$
begin
  if tg_op = 'INSERT' and new.chamado_id is null then return null; end if;
  if tg_op = 'UPDATE' and old.situacao is not distinct from new.situacao then return null; end if;
  if new.situacao in ('agendado', 'confirmado') then perform app_agenda_mover_chamado(new.id, 'AGENDADO'); end if;
  return null;
end $$;

-- Dados do agendamento do chamado para o robô perguntar a confirmação
create or replace function app_robo_agendamento(p_chamado uuid) returns jsonb
language sql stable security definer as $$
  select jsonb_build_object('id', a.id, 'nome', a.nome, 'inicio', a.inicio, 'placa', a.placa, 'loja', jsonb_build_object('nome', l.nome))
    from agendamentos a join lojas l on l.id = a.loja_id
   where a.id = app_agendamento_do_chamado(p_chamado) and a.situacao = 'agendado' and a.inicio > now()
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_robo_agendamento(uuid) to app_api;
  end if;
end $$;
