-- Venda finalizada = cliente compareceu: o agendamento da venda passa para COMPARECEU sozinho.
-- Agendamento sem venda ligada (ex.: marcado na agenda e a venda feita depois, à parte) é achado
-- pela mesma unidade e dia, com a mesma placa ou o mesmo cliente cadastrado, e fica ligado à venda.

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
   where venda_id = v.id and situacao in ('agendado', 'confirmado');
end $$;

create or replace function trg_venda_agenda_compareceu() returns trigger language plpgsql security definer as $$
begin
  if new.situacao = 'finalizada' and (tg_op = 'INSERT' or old.situacao is distinct from 'finalizada') then
    perform app_venda_agenda_compareceu(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_venda_agenda_compareceu on vendas;
create trigger trg_venda_agenda_compareceu after insert or update of situacao on vendas
  for each row execute function trg_venda_agenda_compareceu();

-- Compareceu: o chamado do WhatsApp desse agendamento vai para a coluna que conclui (CONCLUÍDO)
create or replace function app_agenda_concluir_chamado(p_ag uuid) returns void
language plpgsql security definer as $$
declare a agendamentos;
        col uuid;
begin
  select * into a from agendamentos where id = p_ag;
  if a.id is null or a.situacao <> 'compareceu' then return; end if;
  select id into col from whatsapp_colunas where empresa_id = a.empresa_id and finaliza order by ordem limit 1;
  if col is null then return; end if;
  update whatsapp_chamados h
     set coluna_id = col, aberto = false, concluido_em = now(), atualizado_em = now(),
         ordem = coalesce((select min(ordem) from whatsapp_chamados where coluna_id = col), 1) - 1
   where h.aberto and h.empresa_id = a.empresa_id
     and (h.id = a.chamado_id
          or (a.venda_id is not null and h.venda_id = a.venda_id)
          or (a.chamado_id is null and h.contato_id in (select k.id from whatsapp_contatos k
                                                        where k.empresa_id = a.empresa_id and tel_chave(k.telefone) = tel_chave(a.telefone))));
end $$;

create or replace function trg_agenda_concluir_chamado() returns trigger language plpgsql security definer as $$
begin
  if new.situacao = 'compareceu' and old.situacao is distinct from 'compareceu' then
    perform app_agenda_concluir_chamado(new.id);
  end if;
  return null;
end $$;
drop trigger if exists trg_agenda_concluir_chamado on agendamentos;
create trigger trg_agenda_concluir_chamado after update of situacao on agendamentos
  for each row execute function trg_agenda_concluir_chamado();

-- Acerta as vendas já finalizadas (ex.: venda nº 18 que ficou AGENDADO na agenda)
do $$
declare r record;
begin
  for r in select id from vendas where situacao = 'finalizada' and data_venda > current_date - 90 loop
    perform app_venda_agenda_compareceu(r.id);
  end loop;
  -- e conclui o chamado dos que compareceram nos últimos dias com a venda finalizada
  for r in select a.id from agendamentos a join vendas v on v.id = a.venda_id
            where a.situacao = 'compareceu' and v.situacao = 'finalizada' and a.inicio > now() - interval '7 days' loop
    perform app_agenda_concluir_chamado(r.id);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_venda_agenda_compareceu(uuid), app_agenda_concluir_chamado(uuid) to app_api;
  end if;
end $$;
