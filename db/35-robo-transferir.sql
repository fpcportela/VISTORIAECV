-- Bloco "Transferir" do robô: leva o chamado para uma coluna do quadro e/ou para um responsável.
-- Só aceita coluna e usuário do mesmo grupo; coluna que finaliza não vale (o chamado fecharia).

create or replace function app_robo_transferir(p_chamado uuid, p_coluna uuid, p_responsavel uuid) returns void
language plpgsql security definer as $$
declare h whatsapp_chamados;
begin
  select * into h from whatsapp_chamados where id = p_chamado;
  if h.id is null then return; end if;
  if p_coluna is not null and p_coluna <> h.coluna_id
     and exists (select 1 from whatsapp_colunas c where c.id = p_coluna and c.empresa_id = h.empresa_id and not c.finaliza) then
    update whatsapp_chamados
       set coluna_id = p_coluna, atualizado_em = now(),
           ordem = coalesce((select min(ordem) from whatsapp_chamados where coluna_id = p_coluna), 1) - 1
     where id = h.id;
  end if;
  if p_responsavel is not null
     and exists (select 1 from usuarios u where u.id = p_responsavel and u.ativo
                   and (u.admin_rede or exists (select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
                                                 where ul.usuario_id = u.id and ul.ativo and l.empresa_id = h.empresa_id))) then
    update whatsapp_chamados set responsavel_id = p_responsavel, atualizado_em = now() where id = h.id;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_robo_transferir(uuid, uuid, uuid) to app_api;
  end if;
end $$;

-- Ícone da agenda no cartão do chamado: acha o agendamento pelo celular
create index if not exists agendamentos_tel_chave on agendamentos(empresa_id, tel_chave(telefone));
