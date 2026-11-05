-- Quem salva a venda fica como responsável no chamado do WhatsApp ligado a ela
-- (o chamado da venda ou o do agendamento da venda).
create or replace function app_venda_responsavel_chamado(p_venda uuid, p_usuario uuid) returns void
language sql security definer as $$
  update whatsapp_chamados h
     set responsavel_id = p_usuario, atualizado_em = now()
    from vendas v
   where v.id = p_venda and h.empresa_id = v.empresa_id and h.responsavel_id is distinct from p_usuario
     and (h.venda_id = v.id or h.id in (select a.chamado_id from agendamentos a where a.venda_id = v.id))
     and exists (select 1 from usuarios u where u.id = p_usuario and u.ativo)
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_venda_responsavel_chamado(uuid, uuid) to app_api;
  end if;
end $$;
