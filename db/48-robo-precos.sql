-- Preço de cada serviço para o robô mostrar "serviço - valor" (o valor da base de conhecimento vem antes;
-- sem ele, o valor padrão do cadastro de serviços). Pode rodar de novo sem problema.
create or replace function app_robo_precos(p_empresa uuid) returns table (id uuid, valor numeric)
language sql stable security definer as $$
  select s.id, s.valor_padrao from servicos s where s.empresa_id = p_empresa and s.ativo
$$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_robo_precos(uuid) to app_api;
  end if;
end $$;
