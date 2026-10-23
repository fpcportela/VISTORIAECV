-- =====================================================================
-- Acesso por perfil: o que cada usuário pode ver e quem pode configurar
-- O master (usuarios.admin_rede) tem acesso a todos os módulos.
-- =====================================================================

-- Permissões do usuário logado em cada loja
create or replace function app_meus_acessos()
returns table (loja_id uuid, permissao text)
language sql stable security definer as $$
  select l.id, p.codigo
    from lojas l cross join permissoes p
   where eh_admin_rede() and l.ativo
  union
  select ul.loja_id, pp.permissao
    from usuario_lojas ul
    join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
   where ul.usuario_id = app_usuario_atual() and ul.ativo and not eh_admin_rede()
$$;

-- Pode configurar usuários/perfis desta empresa?
create or replace function gerencia_empresa(p_empresa uuid) returns boolean
language sql stable security definer as $$
  select eh_admin_rede() or exists (
    select 1 from lojas l
     where l.empresa_id = p_empresa and pode(l.id, 'usuarios.gerenciar'))
$$;

-- Perfis que o usuário logado pode configurar, com suas permissões
create or replace function app_perfis()
returns table (id uuid, empresa_id uuid, empresa text, nome text, descricao text,
               permissoes text[], usuarios integer)
language sql stable security definer as $$
  select pf.id, pf.empresa_id, coalesce(e.nome_fantasia, e.razao_social), pf.nome, pf.descricao,
         coalesce(array_agg(pp.permissao order by pp.permissao) filter (where pp.permissao is not null), '{}'),
         (select count(distinct ul.usuario_id)::int from usuario_lojas ul where ul.perfil_id = pf.id)
    from perfis pf
    join empresas e on e.id = pf.empresa_id
    left join perfil_permissoes pp on pp.perfil_id = pf.id
   where gerencia_empresa(pf.empresa_id)
   group by pf.id, e.id
   order by e.razao_social, pf.nome
$$;

-- Cria (p_id nulo) ou altera um perfil e define exatamente as suas permissões
create or replace function app_salvar_perfil(p_id uuid, p_empresa uuid, p_nome text,
                                             p_descricao text, p_permissoes text[])
returns uuid
language plpgsql security definer as $$
declare v_id uuid := p_id;
        v_empresa uuid := p_empresa;
begin
  if v_id is not null then
    select empresa_id into v_empresa from perfis where id = v_id;
  end if;
  if v_empresa is null or not gerencia_empresa(v_empresa) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if coalesce(trim(p_nome), '') = '' then
    raise exception 'Informe o nome do perfil.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into perfis (empresa_id, nome, descricao) values (v_empresa, trim(p_nome), p_descricao)
    returning id into v_id;
  else
    update perfis set nome = trim(p_nome), descricao = p_descricao where id = v_id;
  end if;

  delete from perfil_permissoes where perfil_id = v_id;
  insert into perfil_permissoes (perfil_id, permissao)
  select v_id, codigo from permissoes where codigo = any(coalesce(p_permissoes, '{}'));
  return v_id;
end $$;

create or replace function app_excluir_perfil(p_id uuid) returns void
language plpgsql security definer as $$
declare v_empresa uuid;
begin
  select empresa_id into v_empresa from perfis where id = p_id;
  if v_empresa is null or not gerencia_empresa(v_empresa) then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;
  if exists (select 1 from usuario_lojas where perfil_id = p_id) then
    raise exception 'Este perfil está em uso. Troque o perfil dos usuários antes de excluir.' using errcode = '23503';
  end if;
  delete from perfis where id = p_id;
end $$;

-- Usuários das lojas que o usuário logado gerencia, com a loja e o perfil de cada vínculo
create or replace function app_usuarios()
returns table (id uuid, nome text, email text, ativo boolean, master boolean, vinculos jsonb)
language sql stable security definer as $$
  select u.id, u.nome, u.email, u.ativo, u.admin_rede,
         coalesce(jsonb_agg(jsonb_build_object('loja_id', ul.loja_id, 'perfil_id', ul.perfil_id))
                  filter (where ul.loja_id is not null), '[]')
    from usuarios u
    left join usuario_lojas ul on ul.usuario_id = u.id
         and (eh_admin_rede() or pode(ul.loja_id, 'usuarios.gerenciar'))
   where eh_admin_rede()
      or exists (select 1 from usuario_lojas x
                  where x.usuario_id = u.id and pode(x.loja_id, 'usuarios.gerenciar'))
   group by u.id
   order by u.nome
$$;

-- Cria (p_id nulo) ou altera um usuário e os seus vínculos (loja + perfil).
-- Só mexe nos vínculos das lojas que quem está salvando gerencia.
-- p_vinculos: [{"loja_id": "...", "perfil_id": "..."}]
create or replace function app_salvar_usuario(p_id uuid, p_nome text, p_email text, p_senha text,
                                              p_ativo boolean, p_vinculos jsonb)
returns uuid
language plpgsql security definer as $$
declare v_id uuid := p_id;
        v jsonb;
        v_loja uuid;
        v_perfil uuid;
begin
  if coalesce(trim(p_nome), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'Informe nome e e-mail.' using errcode = '22023';
  end if;

  -- precisa gerenciar todas as lojas pedidas
  for v in select * from jsonb_array_elements(coalesce(p_vinculos, '[]')) loop
    v_loja := (v->>'loja_id')::uuid;
    v_perfil := (v->>'perfil_id')::uuid;
    if not (eh_admin_rede() or pode(v_loja, 'usuarios.gerenciar')) then
      raise exception 'sem_permissao' using errcode = '42501';
    end if;
    if not exists (select 1 from perfis pf join lojas l on l.empresa_id = pf.empresa_id
                    where pf.id = v_perfil and l.id = v_loja) then
      raise exception 'O perfil escolhido não pertence ao grupo da loja.' using errcode = '22023';
    end if;
  end loop;

  if v_id is null then
    if coalesce(length(p_senha), 0) < 6 then
      raise exception 'A senha precisa ter pelo menos 6 caracteres.' using errcode = '22023';
    end if;
    if jsonb_array_length(coalesce(p_vinculos, '[]')) = 0 and not eh_admin_rede() then
      raise exception 'Escolha pelo menos uma loja para o usuário.' using errcode = '22023';
    end if;
    insert into usuarios (nome, email, senha_hash, ativo)
    values (trim(p_nome), lower(trim(p_email)), crypt(p_senha, gen_salt('bf')), coalesce(p_ativo, true))
    returning id into v_id;
  else
    -- quem não é master só altera usuários das lojas que gerencia, e nunca um master
    if not eh_admin_rede() and (
         coalesce((select admin_rede from usuarios where id = v_id), false)
         or not exists (select 1 from usuario_lojas x
                         where x.usuario_id = v_id and pode(x.loja_id, 'usuarios.gerenciar'))) then
      raise exception 'sem_permissao' using errcode = '42501';
    end if;
    update usuarios set nome = trim(p_nome), email = lower(trim(p_email)), ativo = coalesce(p_ativo, ativo),
           senha_hash = case when coalesce(length(p_senha), 0) >= 6 then crypt(p_senha, gen_salt('bf')) else senha_hash end
     where id = v_id;
    if p_senha is not null and length(p_senha) between 1 and 5 then
      raise exception 'A senha precisa ter pelo menos 6 caracteres.' using errcode = '22023';
    end if;
  end if;

  delete from usuario_lojas ul
   where ul.usuario_id = v_id and (eh_admin_rede() or pode(ul.loja_id, 'usuarios.gerenciar'));
  insert into usuario_lojas (usuario_id, loja_id, perfil_id)
  select v_id, (x->>'loja_id')::uuid, (x->>'perfil_id')::uuid
    from jsonb_array_elements(coalesce(p_vinculos, '[]')) x;
  return v_id;
end $$;

-- Atalhos da tela inicial escolhidos pelo usuário logado (null = padrão)
create or replace function app_meus_atalhos() returns text[]
language sql stable security definer as $$
  select atalhos from usuario_atalhos where usuario_id = app_usuario_atual()
$$;

create or replace function app_salvar_atalhos(p_atalhos text[]) returns void
language sql security definer as $$
  insert into usuario_atalhos (usuario_id, atalhos) values (app_usuario_atual(), coalesce(p_atalhos, '{}'))
  on conflict (usuario_id) do update set atalhos = excluded.atalhos, atualizado_em = now()
$$;
