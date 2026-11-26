-- Robô leva o chamado para a coluna cujo nome começa com o prefixo (sem acento), ex.: AGUARDANDO.
-- Sem essa coluna no grupo, nada muda. Pode rodar de novo sem problema.
create or replace function app_robo_mover_coluna(p_chamado uuid, p_prefixo text) returns void
language plpgsql security definer as $$
declare col uuid;
begin
  select c.id into col from whatsapp_colunas c join whatsapp_chamados h on h.empresa_id = c.empresa_id
   where h.id = p_chamado and not c.finaliza
     and translate(upper(trim(c.nome)), 'ÁÀÂÃÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC') like p_prefixo || '%'
   order by c.ordem limit 1;
  if col is null then return; end if;
  update whatsapp_chamados set coluna_id = col, atualizado_em = now(),
         ordem = coalesce((select min(ordem) from whatsapp_chamados where coluna_id = col), 1) - 1
   where id = p_chamado and aberto and coluna_id <> col;
end $$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_robo_mover_coluna(uuid, text) to app_api;
  end if;
end $$;
