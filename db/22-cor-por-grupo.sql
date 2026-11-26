-- Cor do sistema salva por GRUPO: todo mundo do grupo vê a mesma cor.
-- Grupo em uso = o escolhido no topo (master) ou o único grupo da pessoa.
-- Sem grupo definido (master em "todos os grupos"), vale a cor pessoal.

create or replace function app_grupo_da_cor() returns uuid
language sql stable security definer as $$
  select coalesce(grupo_ativo(),
    (select min(l.empresa_id::text)::uuid from usuario_lojas ul join lojas l on l.id = ul.loja_id
      where ul.usuario_id = app_usuario_atual() and not eh_admin_rede()
     having count(distinct l.empresa_id) = 1))
$$;

create or replace function app_cor_tema()
returns text
language sql stable security definer as $$
  select coalesce(
    (select cor_primaria from preferencias_tema where usuario_id is null and empresa_id = app_grupo_da_cor()),
    case when app_grupo_da_cor() is null then (select cor_primaria from preferencias_tema where usuario_id = app_usuario_atual()) end,
    '#0774B8')
$$;

-- Quem pode mudar a cor do grupo: master ou quem configura o sistema numa loja do grupo
create or replace function app_pode_cor_tema() returns boolean
language sql stable security definer as $$
  select case when app_grupo_da_cor() is null then true
              else eh_admin_rede() or exists (select 1 from lojas l where l.empresa_id = app_grupo_da_cor() and pode(l.id, 'config.gerenciar')) end
$$;

create or replace function app_salvar_cor_tema(p_cor text)
returns void
language plpgsql security definer as $$
declare v_grupo uuid := app_grupo_da_cor();
begin
  if v_grupo is null then
    insert into preferencias_tema (usuario_id, cor_primaria) values (app_usuario_atual(), p_cor)
    on conflict (usuario_id) where usuario_id is not null
    do update set cor_primaria = excluded.cor_primaria, atualizado_em = now();
    return;
  end if;
  if not app_pode_cor_tema() then
    raise exception 'Só o administrador do grupo muda a cor do sistema.' using errcode = '42501';
  end if;
  insert into preferencias_tema (empresa_id, cor_primaria) values (v_grupo, p_cor)
  on conflict (empresa_id) where usuario_id is null
  do update set cor_primaria = excluded.cor_primaria, atualizado_em = now();
end $$;

-- grupos sem cor própria herdam a cor pessoal que o dono do grupo já tinha escolhido (se houver uma só)
insert into preferencias_tema (empresa_id, cor_primaria)
select e.id, min(p.cor_primaria)
  from empresas e
  join lojas l on l.empresa_id = e.id
  join usuario_lojas ul on ul.loja_id = l.id
  join preferencias_tema p on p.usuario_id = ul.usuario_id
 where not exists (select 1 from preferencias_tema x where x.empresa_id = e.id and x.usuario_id is null)
 group by e.id
having count(distinct p.cor_primaria) = 1
on conflict do nothing;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_grupo_da_cor(), app_cor_tema(), app_pode_cor_tema(), app_salvar_cor_tema(text) to app_api;
  end if;
end $$;
