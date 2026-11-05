-- Agendamento de um chamado: o ligado a ele (ou à venda dele); senão o do mesmo celular,
-- de preferência o próximo (não cancelado).
create or replace function app_agendamento_do_chamado(p_chamado uuid) returns uuid
language sql stable security definer as $$
  select a.id
    from whatsapp_chamados h join whatsapp_contatos k on k.id = h.contato_id
    join agendamentos a on a.empresa_id = h.empresa_id and a.situacao <> 'cancelado'
                       and (a.chamado_id = h.id or (h.venda_id is not null and a.venda_id = h.venda_id)
                            or tel_chave(a.telefone) = tel_chave(k.telefone))
   where h.id = p_chamado
   order by (a.chamado_id = h.id or a.venda_id = h.venda_id) desc nulls last,
            (a.inicio >= now() - interval '12 hours') desc, abs(extract(epoch from a.inicio - now()))
   limit 1
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_agendamento_do_chamado(uuid) to app_api;
  end if;
end $$;
