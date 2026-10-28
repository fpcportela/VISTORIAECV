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

-- Acerta as vendas já finalizadas (ex.: venda nº 18 que ficou AGENDADO na agenda)
do $$
declare r record;
begin
  for r in select id from vendas where situacao = 'finalizada' and data_venda > current_date - 90 loop
    perform app_venda_agenda_compareceu(r.id);
  end loop;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_venda_agenda_compareceu(uuid) to app_api;
  end if;
end $$;
