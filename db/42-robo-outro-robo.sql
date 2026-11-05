-- O robô percebeu que do outro lado é outro robô: para (a conversa fica para uma pessoa) e avisa no assunto
create or replace function app_robo_parar_outro_robo(p_chamado uuid, p_motivo text) returns void
language sql security definer as $$
  update whatsapp_chamados
     set robo_estado = 'humano', atualizado_em = now(),
         titulo = coalesce(nullif(titulo, ''), 'ROBÔ PAROU: OUTRO ROBÔ (' || upper(p_motivo) || ')')
   where id = p_chamado
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_robo_parar_outro_robo(uuid, text) to app_api;
  end if;
end $$;
