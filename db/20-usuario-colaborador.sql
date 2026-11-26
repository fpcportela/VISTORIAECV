-- Usuário e colaborador amarrados: o que muda num lado (nome, CPF, celular, cargo) muda no outro.
-- Usuários e colaboradores nunca são apagados, só inativados (para guardar o registro de tudo).

create or replace function proibir_apagar() returns trigger
language plpgsql as $$
begin
  raise exception 'Este cadastro não pode ser apagado, só inativado (para guardar o histórico).' using errcode = '42501';
end $$;
drop trigger if exists trg_usuarios_nao_apagar on usuarios;
create trigger trg_usuarios_nao_apagar before delete on usuarios for each row execute function proibir_apagar();
drop trigger if exists trg_colaboradores_nao_apagar on colaboradores;
create trigger trg_colaboradores_nao_apagar before delete on colaboradores for each row execute function proibir_apagar();

-- Colaborador -> usuário. Inativar o colaborador também tira o acesso dele ao sistema
-- (o contrário não: tirar o acesso não inativa o colaborador).
create or replace function colaborador_para_usuario() returns trigger
language plpgsql security definer as $$
begin
  if new.usuario_id is null then return null; end if;
  update usuarios u
     set nome = new.nome,
         telefone = coalesce(new.celular, u.telefone),
         cpf = case when new.cpf is not null and not exists (select 1 from usuarios x where x.cpf = new.cpf and x.id <> u.id)
                    then new.cpf else u.cpf end,
         cargo_id = coalesce(new.cargo_id, u.cargo_id),
         ativo = case when new.ativo then u.ativo else false end,
         atualizado_em = now()
   where u.id = new.usuario_id
     and (u.nome is distinct from new.nome
          or (new.celular is not null and u.telefone is distinct from new.celular)
          or (new.cpf is not null and u.cpf is distinct from new.cpf
              and not exists (select 1 from usuarios x where x.cpf = new.cpf and x.id <> u.id))
          or (new.cargo_id is not null and u.cargo_id is distinct from new.cargo_id)
          or (not new.ativo and u.ativo));
  return null;
end $$;
drop trigger if exists trg_colaborador_para_usuario on colaboradores;
create trigger trg_colaborador_para_usuario after insert or update on colaboradores
  for each row execute function colaborador_para_usuario();

-- Usuário -> colaborador (o cargo só passa se for do mesmo grupo do colaborador)
create or replace function usuario_para_colaborador() returns trigger
language plpgsql security definer as $$
begin
  update colaboradores c
     set nome = new.nome,
         celular = coalesce(new.telefone, c.celular),
         cpf = case when new.cpf is not null and not exists (select 1 from colaboradores x where x.empresa_id = c.empresa_id and x.cpf = new.cpf and x.id <> c.id)
                    then new.cpf else c.cpf end,
         cargo_id = case when new.cargo_id is not null and exists (select 1 from cargos k where k.id = new.cargo_id and k.empresa_id = c.empresa_id)
                         then new.cargo_id else c.cargo_id end,
         atualizado_em = now()
   where c.usuario_id = new.id
     and (c.nome is distinct from new.nome
          or (new.telefone is not null and c.celular is distinct from new.telefone)
          or (new.cpf is not null and c.cpf is distinct from new.cpf
              and not exists (select 1 from colaboradores x where x.empresa_id = c.empresa_id and x.cpf = new.cpf and x.id <> c.id))
          or (new.cargo_id is not null and c.cargo_id is distinct from new.cargo_id
              and exists (select 1 from cargos k where k.id = new.cargo_id and k.empresa_id = c.empresa_id)));
  return null;
end $$;
drop trigger if exists trg_usuario_para_colaborador on usuarios;
create trigger trg_usuario_para_colaborador after update on usuarios
  for each row execute function usuario_para_colaborador();

-- Colaboradores que a pessoa pode ligar a um usuário (pesquisa por nome, CPF ou celular)
create or replace function app_colaboradores_para_usuario(p_busca text)
returns table (id uuid, nome text, cpf text, celular text, cargo_id uuid, cargo text, loja_id uuid, loja text, usuario_id uuid, usuario text)
language sql stable security definer as $$
  select c.id, c.nome, c.cpf, c.celular, c.cargo_id, k.nome, c.loja_id, l.nome, c.usuario_id, u.nome
    from colaboradores c
    join lojas l on l.id = c.loja_id
    left join cargos k on k.id = c.cargo_id
    left join usuarios u on u.id = c.usuario_id
   where c.ativo
     and (eh_admin_rede() or pode(c.loja_id, 'usuarios.gerenciar'))
     and (grupo_ativo() is null or c.empresa_id = grupo_ativo())
     and length(trim(coalesce(p_busca, ''))) >= 2
     and (c.nome ilike '%' || trim(p_busca) || '%'
          or (regexp_replace(p_busca, '\D', '', 'g') <> ''
              and (c.cpf like regexp_replace(p_busca, '\D', '', 'g') || '%' or c.celular like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%')))
   order by c.nome
   limit 15
$$;

-- Liga (ou desliga) o colaborador ao usuário
create or replace function app_ligar_colaborador_usuario(p_usuario uuid, p_colaborador uuid) returns void
language plpgsql security definer as $$
declare v_c colaboradores;
begin
  if p_colaborador is null then
    update colaboradores set usuario_id = null where usuario_id = p_usuario
       and (eh_admin_rede() or pode(loja_id, 'usuarios.gerenciar'));
    return;
  end if;
  select * into v_c from colaboradores where id = p_colaborador;
  if v_c.id is null or not (eh_admin_rede() or pode(v_c.loja_id, 'usuarios.gerenciar')) then
    raise exception 'Colaborador não encontrado.' using errcode = '22023';
  end if;
  if v_c.usuario_id is not null and v_c.usuario_id <> p_usuario then
    raise exception 'Este colaborador já está ligado a outro usuário.' using errcode = '22023';
  end if;
  update colaboradores set usuario_id = null where usuario_id = p_usuario and id <> p_colaborador;
  update colaboradores set usuario_id = p_usuario where id = p_colaborador;
end $$;

-- Colaborador ligado a cada usuário (para a lista de usuários)
create or replace function app_colaborador_do_usuario()
returns table (usuario_id uuid, colaborador_id uuid, colaborador text)
language sql stable security definer as $$
  select c.usuario_id, c.id, c.nome from colaboradores c
   where c.usuario_id is not null and (eh_admin_rede() or pode(c.loja_id, 'usuarios.gerenciar') or pode(c.loja_id, 'colaboradores.ver'))
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_colaboradores_para_usuario(text), app_ligar_colaborador_usuario(uuid, uuid),
      app_colaborador_do_usuario() to app_api;
  end if;
end $$;
