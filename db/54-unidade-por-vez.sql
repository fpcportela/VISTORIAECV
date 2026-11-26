-- =====================================================================
-- Ver todas as unidades juntas só com "Todas as unidades".
-- Quem trabalha em várias unidades sem essa opção marcada vê uma unidade
-- por vez: escolhe a unidade no topo da tela e só enxerga (e mexe) nela.
--   usuarios.todas_unidades      pode ver todas as unidades juntas ("Todas as lojas" no topo)
--   colaboradores.todas_unidades a mesma opção no cadastro do colaborador (vai para o login dele)
-- A unidade escolhida no topo chega da API em app.loja (cabeçalho X-Loja).
-- O master e quem tem uma unidade só não mudam.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

do $$
begin
  -- Na primeira vez, quem já está em todas as unidades do grupo fica com "Todas as unidades"
  -- marcado, para não mudar nada para quem já via tudo junto.
  if not exists (select 1 from information_schema.columns where table_name = 'usuarios' and column_name = 'todas_unidades') then
    alter table usuarios add column todas_unidades boolean not null default false;
    update usuarios u set todas_unidades = true
     where exists (select 1 from usuario_lojas ul where ul.usuario_id = u.id and ul.ativo)
       and not exists (
         select 1 from lojas l
          where l.ativo
            and l.empresa_id in (select l2.empresa_id from usuario_lojas ul2 join lojas l2 on l2.id = ul2.loja_id
                                  where ul2.usuario_id = u.id and ul2.ativo)
            and not exists (select 1 from usuario_lojas x where x.usuario_id = u.id and x.loja_id = l.id and x.ativo));
  end if;
  if not exists (select 1 from information_schema.columns where table_name = 'colaboradores' and column_name = 'todas_unidades') then
    alter table colaboradores add column todas_unidades boolean not null default false;
    update colaboradores c set todas_unidades = true
     where not exists (
       select 1 from lojas l
        where l.ativo and l.empresa_id = c.empresa_id
          and not exists (select 1 from colaborador_lojas x where x.colaborador_id = c.id and x.loja_id = l.id))
       and (select count(*) from lojas l where l.ativo and l.empresa_id = c.empresa_id) > 1;
  end if;
end $$;

-- Unidade escolhida no topo da tela (vazio = "Todas as lojas")
create or replace function loja_ativa() returns uuid
language sql stable as $$
  select nullif(current_setting('app.loja', true), '')::uuid
$$;

-- O usuário logado vê uma unidade por vez? (não é master, não tem "Todas as unidades"
-- e trabalha em mais de uma unidade)
create or replace function unidade_por_vez() returns boolean
language sql stable security definer as $$
  select not eh_admin_rede()
     and not coalesce((select todas_unidades from usuarios where id = app_usuario_atual()), false)
     and (select count(*) from usuario_lojas ul join lojas l on l.id = ul.loja_id
           where ul.usuario_id = app_usuario_atual() and ul.ativo and l.ativo) > 1
$$;

-- A unidade X está liberada agora? Sempre, menos para quem vê uma por vez: só a escolhida no topo.
create or replace function na_unidade(p_loja uuid) returns boolean
language sql stable security definer as $$
  select p_loja is not distinct from loja_ativa() or not unidade_por_vez()
$$;

-- Vínculo do usuário com a unidade, sem olhar a unidade escolhida no topo. Serve para
-- listar as unidades da pessoa (a troca no topo) e para o cadastro de quem trabalha onde.
create or replace function tem_loja_vinculo(p_loja uuid) returns boolean
language sql stable security definer as $$
  select case when eh_admin_rede()
           then grupo_ativo() is null or exists (select 1 from lojas where id = p_loja and empresa_id = grupo_ativo())
           else exists (select 1 from usuario_lojas where usuario_id = app_usuario_atual() and loja_id = p_loja and ativo) end
$$;

create or replace function pode_vinculo(p_loja uuid, p_permissao text) returns boolean
language sql stable security definer as $$
  select case when eh_admin_rede()
           then grupo_ativo() is null or exists (select 1 from lojas where id = p_loja and empresa_id = grupo_ativo())
           else exists (select 1 from usuario_lojas ul join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
                         where ul.usuario_id = app_usuario_atual() and ul.loja_id = p_loja and ul.ativo
                           and pp.permissao = p_permissao) end
$$;

-- As regras de acesso de todo o sistema (telas e RLS) passam a respeitar a unidade escolhida
create or replace function tem_loja(p_loja uuid) returns boolean
language sql stable security definer as $$
  select tem_loja_vinculo(p_loja) and na_unidade(p_loja)
$$;

create or replace function pode(p_loja uuid, p_permissao text) returns boolean
language sql stable security definer as $$
  select pode_vinculo(p_loja, p_permissao) and na_unidade(p_loja)
$$;

-- Unidades da pessoa para a troca no topo: todas as dela, mesmo vendo uma por vez
create or replace function app_minhas_lojas()
returns table (id uuid, codigo text, nome text, empresa_id uuid, empresa text)
language sql stable security definer as $$
  select l.id, l.codigo, l.nome, e.id, coalesce(e.nome_fantasia, e.razao_social)
    from lojas l join empresas e on e.id = l.empresa_id
   where l.ativo and tem_loja_vinculo(l.id)
   order by e.razao_social, l.codigo
$$;

-- Marca ou desmarca "Todas as unidades" de um usuário (e do colaborador ligado a ele).
-- Precisa gerenciar usuários em todas as unidades da pessoa; nunca mexe num master.
create or replace function app_definir_todas_unidades(p_usuario uuid, p_todas boolean) returns void
language plpgsql security definer as $$
begin
  if p_todas is null or p_usuario is null then return; end if;
  if (select todas_unidades from usuarios where id = p_usuario) is not distinct from p_todas then
    update colaboradores set todas_unidades = p_todas where usuario_id = p_usuario;
    return;
  end if;
  if not eh_admin_rede() and (
       coalesce((select admin_rede from usuarios where id = p_usuario), false)
       or not exists (select 1 from usuario_lojas x where x.usuario_id = p_usuario and x.ativo)
       or exists (select 1 from usuario_lojas x where x.usuario_id = p_usuario and x.ativo
                     and not pode_vinculo(x.loja_id, 'usuarios.gerenciar'))) then
    raise exception 'Só quem gerencia usuários em todas as unidades da pessoa pode mudar "Todas as unidades".' using errcode = '42501';
  end if;
  update usuarios set todas_unidades = p_todas, atualizado_em = now() where id = p_usuario;
  update colaboradores set todas_unidades = p_todas where usuario_id = p_usuario;
end $$;

-- "Todas as unidades" dos usuários que a pessoa vê (tela Usuários e permissões)
create or replace function app_usuarios_todas_unidades()
returns table (id uuid, todas_unidades boolean)
language sql stable security definer as $$
  select u.id, u.todas_unidades from app_usuarios() a join usuarios u on u.id = a.id
$$;

-- Todas as unidades em que o colaborador trabalha, mesmo as que a pessoa não vê agora
-- (o cadastro mostra todas e, ao salvar, mantém as que a pessoa não pode mexer)
create or replace function app_colaborador_lojas(p_colab uuid) returns setof uuid
language sql stable security definer as $$
  select cl.loja_id from colaborador_lojas cl
   where cl.colaborador_id = p_colab
     and (pode_ver_colaborador(p_colab, 'colaboradores.ver') or pode_colaborador(p_colab, 'colaboradores.editar'))
$$;

-- Acesso do colaborador: só repassa ao login as unidades que quem salva gerencia agora
-- (as outras continuam como estão)
create or replace function app_colaborador_acesso(p_colab uuid, p_acessa boolean, p_login text, p_senha text, p_perfil uuid)
returns uuid
language plpgsql security definer as $$
declare v_c colaboradores;
        v_login text := lower(trim(coalesce(p_login, '')));
        v_vinculos jsonb;
        v_uid uuid;
begin
  select * into v_c from colaboradores where id = p_colab;
  if v_c.id is null or not pode_colaborador(p_colab, 'colaboradores.editar') then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if not coalesce(p_acessa, false) then
    if v_c.usuario_id is not null then
      if not eh_admin_rede() and not exists (select 1 from usuario_lojas x
                                              where x.usuario_id = v_c.usuario_id and pode(x.loja_id, 'usuarios.gerenciar')) then
        raise exception 'sem_permissao' using errcode = '42501';
      end if;
      update usuarios set ativo = false, atualizado_em = now() where id = v_c.usuario_id and not admin_rede;
    end if;
    return v_c.usuario_id;
  end if;

  if v_login !~ '^[a-z0-9._@-]{3,80}$' then
    raise exception 'Usuário inválido: use de 3 a 80 letras, números, ponto, hífen ou um e-mail (sem espaço).' using errcode = '22023';
  end if;
  if exists (select 1 from usuarios where email = v_login and id is distinct from v_c.usuario_id) then
    raise exception 'Já existe alguém com esse usuário. Escolha outro.' using errcode = '22023';
  end if;
  if p_perfil is null then
    raise exception 'Escolha o perfil de acesso do colaborador.' using errcode = '22023';
  end if;
  if v_c.celular is null then
    raise exception 'Informe o celular do colaborador: é por ele que chega o código de "Esqueci a senha".' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('loja_id', cl.loja_id, 'perfil_id', p_perfil)) into v_vinculos
    from colaborador_lojas cl where cl.colaborador_id = p_colab
     and (eh_admin_rede() or pode(cl.loja_id, 'usuarios.gerenciar'));
  v_uid := app_salvar_usuario(v_c.usuario_id, v_c.nome, v_login, nullif(p_senha, ''), true, coalesce(v_vinculos, '[]'),
                              (select v_c.cpf where not exists (select 1 from usuarios u where u.cpf = v_c.cpf and u.id is distinct from v_c.usuario_id)),
                              v_c.celular);
  update colaboradores set usuario_id = v_uid where id = p_colab;
  if v_c.cargo_id is not null then perform app_definir_cargo(v_uid, v_c.cargo_id); end if;
  return v_uid;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function loja_ativa(), unidade_por_vez(), na_unidade(uuid), tem_loja_vinculo(uuid), pode_vinculo(uuid, text),
                              app_definir_todas_unidades(uuid, boolean), app_usuarios_todas_unidades(), app_colaborador_lojas(uuid) to app_api;
  end if;
end $$;
