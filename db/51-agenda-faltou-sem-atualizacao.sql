-- Agenda: FALTOU automático quando o agendamento fica 24 h sem atualização depois do horário.
-- Antes só valia para agendamento sem venda; agora vale também com venda ligada que não foi
-- finalizada (venda finalizada já vira COMPARECEU sozinha, pelo db/36).
-- Fica registrado no histórico do agendamento ("Marcado como FALTOU automaticamente").
-- Pode rodar de novo sem problema (npm run banco:atualizar).

alter table agenda_historico drop constraint if exists agenda_historico_acao_check;
alter table agenda_historico add constraint agenda_historico_acao_check
  check (acao in ('confirmado', 'nao_confirmado', 'remarcado', 'faltou_auto'));
alter table agenda_historico drop constraint if exists agenda_historico_origem_check;
alter table agenda_historico add constraint agenda_historico_origem_check
  check (origem in ('whatsapp', 'manual', 'sistema'));

create index if not exists agendamentos_abertos_inicio on agendamentos(inicio) where situacao in ('agendado', 'confirmado');

-- Rotina (roda a cada poucos minutos pela API):
--  1) cliente não respondeu a confirmação até a hora do agendamento: para a pergunta e o robô do chamado
--  2) AGENDADO ou CONFIRMADO, já passou do horário e ninguém mexeu nele há 24 h: vira FALTOU
--     (conta da última atualização ou do horário, o que for mais tarde; venda finalizada não entra)
create or replace function app_agenda_rotina() returns void
language plpgsql security definer as $$
begin
  update whatsapp_chamados h set robo_estado = 'humano', atualizado_em = now()
    from agendamentos a
   where a.confirmacao_etapa is not null and a.inicio <= now() and a.chamado_id = h.id
     and coalesce(h.robo_estado, 'coletando') <> 'humano';
  update agendamentos set confirmacao_etapa = null, confirmacao_dados = null
   where confirmacao_etapa is not null and inicio <= now();

  with faltaram as (
    update agendamentos a set situacao = 'faltou', confirmacao_etapa = null, confirmacao_dados = null, atualizado_em = now()
     where a.situacao in ('agendado', 'confirmado')
       and greatest(a.inicio, a.atualizado_em) < now() - interval '24 hours'
       and not exists (select 1 from vendas v where v.id = a.venda_id and v.situacao = 'finalizada')
    returning a.id, a.empresa_id, a.loja_id, a.inicio
  )
  insert into agenda_historico (agendamento_id, empresa_id, loja_id, acao, de_inicio, origem)
  select id, empresa_id, loja_id, 'faltou_auto', inicio, 'sistema' from faltaram;
end $$;

-- Venda finalizada depois do FALTOU automático: o cliente veio, então o agendamento vira COMPARECEU
-- (igual ao db/36, só aceitando também 'faltou')
create or replace function app_venda_agenda_compareceu(p_venda uuid) returns void
language plpgsql security definer as $$
declare v vendas;
        ag uuid;
begin
  select * into v from vendas where id = p_venda;
  if v.id is null or v.situacao <> 'finalizada' then return; end if;
  if not exists (select 1 from agendamentos where venda_id = v.id) then
    select a.id into ag
      from agendamentos a
     where a.loja_id = v.loja_id and a.venda_id is null and a.situacao in ('agendado', 'confirmado')
       and (a.inicio at time zone 'America/Sao_Paulo')::date
           between least(v.data_venda, coalesce(v.finalizada_em at time zone 'America/Sao_Paulo', v.data_venda)::date) - 1
               and greatest(v.data_venda, coalesce(v.finalizada_em at time zone 'America/Sao_Paulo', v.data_venda)::date)
       and ((a.cliente_id is not null and a.cliente_id = v.cliente_id)
            or exists (select 1 from venda_itens i join veiculos e on e.id = i.veiculo_id
                        where i.venda_id = v.id and a.placa is not null
                          and upper(regexp_replace(e.placa, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(a.placa, '[^A-Za-z0-9]', '', 'g'))))
     order by abs(extract(epoch from a.inicio - coalesce(v.finalizada_em, now())))
     limit 1;
    if ag is not null then update agendamentos set venda_id = v.id where id = ag; end if;
  end if;
  update agendamentos set situacao = 'compareceu', confirmacao_etapa = null, confirmacao_dados = null, atualizado_em = now()
   where venda_id = v.id and situacao in ('agendado', 'confirmado', 'faltou');
end $$;

select app_agenda_rotina();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_agenda_rotina() to app_api;
  end if;
end $$;
