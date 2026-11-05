-- Endereço do grupo; unidade escolhida na conversa do robô; responsável pelo atendimento.

alter table empresas add column if not exists cep text;
alter table empresas add column if not exists logradouro text;
alter table empresas add column if not exists numero text;
alter table empresas add column if not exists bairro text;
alter table empresas add column if not exists cidade text;
alter table empresas add column if not exists uf char(2);

-- Responsável pelos chamados do robô: um por unidade ({loja_id: usuario_id}) e um padrão
alter table whatsapp_robo add column if not exists responsavel_id uuid references usuarios(id) on delete set null;
alter table whatsapp_robo add column if not exists responsaveis jsonb not null default '{}';

-- Unidade da conversa: a escolhida pelo cliente, senão a do robô, senão a primeira ativa
create or replace function robo_unidade(p_empresa uuid, p_loja uuid) returns uuid
language sql stable security definer as $$
  select coalesce(
    (select l.id from lojas l where l.id = p_loja and l.empresa_id = p_empresa and l.ativo),
    (select l.id from whatsapp_robo r join lojas l on l.id = r.loja_id and l.ativo where r.empresa_id = p_empresa),
    (select l.id from lojas l where l.empresa_id = p_empresa and l.ativo order by l.nome limit 1))
$$;

create or replace function app_agenda_livres_unidade(p_empresa uuid, p_loja uuid, p_de date, p_limite integer)
returns table (inicio timestamptz, fim timestamptz)
language sql security definer as $$
  select f.inicio, f.fim
    from agenda_livres(robo_unidade(p_empresa, p_loja), p_de, p_de + 60) f
   order by f.inicio
   limit p_limite
$$;

create or replace function app_agenda_unidade_robo(p_empresa uuid, p_loja uuid) returns jsonb
language sql stable security definer as $$
  select to_jsonb(x) from (
    select l.id, l.nome, l.logradouro, l.numero, l.bairro, l.cidade, l.uf, l.cep,
           (select c.horarios from agenda_config c where c.loja_id = l.id and c.ativo) as horarios
      from lojas l where l.id = robo_unidade(p_empresa, p_loja)) x
$$;

-- Passa o chamado do robô para o responsável (o da unidade, senão o padrão), se ainda não tem um
create or replace function app_robo_atribuir(p_chamado uuid, p_loja uuid) returns void
language sql security definer as $$
  update whatsapp_chamados h
     set responsavel_id = u.id, atualizado_em = now()
    from whatsapp_robo r, usuarios u
   where h.id = p_chamado and h.responsavel_id is null and r.empresa_id = h.empresa_id and u.ativo
     and u.id = coalesce(nullif(r.responsaveis->>(robo_unidade(h.empresa_id, p_loja)::text), '')::uuid, r.responsavel_id)
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function robo_unidade(uuid, uuid), app_agenda_livres_unidade(uuid, uuid, date, integer),
      app_agenda_unidade_robo(uuid, uuid), app_robo_atribuir(uuid, uuid) to app_api;
  end if;
end $$;
