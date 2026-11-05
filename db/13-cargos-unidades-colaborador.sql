-- =====================================================================
-- Cargos (ex.: SÊNIOR, ATENDENTE, VISTORIADOR) usados no usuário e no colaborador,
-- e colaborador ligado a várias unidades.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

create table if not exists cargos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id),
  nome        text not null,
  perfil_id   uuid references perfis(id) on delete set null,   -- perfil sugerido ao escolher o cargo
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create unique index if not exists cargos_nome on cargos(empresa_id, lower(nome));

alter table usuarios add column if not exists cargo_id uuid references cargos(id) on delete set null;
alter table colaboradores add column if not exists cargo_id uuid references cargos(id) on delete set null;

-- Unidades em que o colaborador trabalha (colaboradores.loja_id continua sendo a principal)
create table if not exists colaborador_lojas (
  colaborador_id  uuid not null references colaboradores(id) on delete cascade,
  loja_id         uuid not null references lojas(id),
  primary key (colaborador_id, loja_id)
);
insert into colaborador_lojas (colaborador_id, loja_id)
select id, loja_id from colaboradores on conflict do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'cargos') then
    alter table cargos enable row level security;
    create policy cargos_por_empresa on cargos for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'colaborador_lojas') then
    alter table colaborador_lojas enable row level security;
    create policy colaborador_lojas_por_loja on colaborador_lojas for all using (tem_loja(loja_id)) with check (tem_loja(loja_id));
  end if;
end $$;

-- Quem trabalha numa unidade também enxerga os colaboradores ligados a ela
drop policy if exists colaboradores_por_loja on colaboradores;
create policy colaboradores_por_loja on colaboradores for all
  using (tem_loja(loja_id) or exists (select 1 from colaborador_lojas cl where cl.colaborador_id = colaboradores.id and tem_loja(cl.loja_id)))
  with check (tem_loja(loja_id) or exists (select 1 from colaborador_lojas cl where cl.colaborador_id = colaboradores.id and tem_loja(cl.loja_id)));

-- O usuário tem a permissão X em alguma unidade do colaborador?
create or replace function pode_colaborador(p_colaborador uuid, p_permissao text) returns boolean
language sql stable security definer as $$
  select exists (select 1 from colaborador_lojas where colaborador_id = p_colaborador and pode(loja_id, p_permissao))
      or exists (select 1 from colaboradores where id = p_colaborador and pode(loja_id, p_permissao))
$$;

-- Cargo do usuário: quem pode alterar o usuário também pode dar o cargo
create or replace function app_definir_cargo(p_usuario uuid, p_cargo uuid) returns void
language plpgsql security definer as $$
begin
  if not eh_admin_rede() and (
       coalesce((select admin_rede from usuarios where id = p_usuario), false)
       or not exists (select 1 from usuario_lojas x where x.usuario_id = p_usuario and pode(x.loja_id, 'usuarios.gerenciar'))) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if p_cargo is not null and not exists (
       select 1 from cargos c where c.id = p_cargo
          and (eh_admin_rede() or exists (select 1 from lojas l where l.empresa_id = c.empresa_id and pode(l.id, 'usuarios.gerenciar')))) then
    raise exception 'Cargo não encontrado.' using errcode = '22023';
  end if;
  update usuarios set cargo_id = p_cargo where id = p_usuario;
end $$;

-- Cargo de cada usuário que a pessoa pode ver
create or replace function app_cargos_usuarios()
returns table (usuario_id uuid, cargo_id uuid, cargo text)
language sql stable security definer as $$
  select a.id, u.cargo_id, c.nome
    from app_usuarios() a join usuarios u on u.id = a.id left join cargos c on c.id = u.cargo_id
$$;

drop trigger if exists aud_cargos on cargos;
create trigger aud_cargos after insert or update or delete on cargos for each row execute function auditar();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on cargos, colaborador_lojas to app_api;
    grant execute on function pode_colaborador(uuid, text), app_definir_cargo(uuid, uuid), app_cargos_usuarios() to app_api;
  end if;
end $$;

-- Confere e-mail e senha de quem autoriza uma ação numa loja (master ou perfil com a permissão)
create or replace function app_autorizar_permissao(p_loja uuid, p_email text, p_senha text, p_permissao text)
returns uuid
language plpgsql security definer as $$
declare v_autorizador uuid;
begin
  select u.id into v_autorizador
    from usuarios u
   where lower(u.email) = lower(trim(coalesce(p_email, ''))) and u.ativo
     and u.senha_hash = crypt(coalesce(p_senha, ''), u.senha_hash)
     and (u.admin_rede or exists (
           select 1 from usuario_lojas ul join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
            where ul.usuario_id = u.id and ul.loja_id = p_loja and ul.ativo and pp.permissao = p_permissao));
  if v_autorizador is null then
    raise exception 'Não autorizado: e-mail ou senha incorretos, ou a pessoa não tem essa permissão.' using errcode = '22023';
  end if;
  return v_autorizador;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_autorizar_permissao(uuid, text, text, text) to app_api;
  end if;
end $$;
