-- =====================================================================
-- Login e funções que a API usa antes de saber quem é o usuário
-- =====================================================================

-- Confere e-mail e senha. Devolve o usuário só se a senha estiver certa.
create or replace function app_login(p_email text, p_senha text)
returns table (id uuid, nome text, email text, admin_rede boolean)
language sql stable security definer as $$
  select u.id, u.nome, u.email, u.admin_rede
    from usuarios u
   where lower(u.email) = lower(p_email)
     and u.ativo
     and u.senha_hash = crypt(p_senha, u.senha_hash)
$$;

-- Lojas que o usuário logado pode ver (admin da rede vê todas)
create or replace function app_minhas_lojas()
returns table (id uuid, codigo text, nome text, empresa_id uuid, empresa text)
language sql stable security definer as $$
  select l.id, l.codigo, l.nome, e.id, coalesce(e.nome_fantasia, e.razao_social)
    from lojas l join empresas e on e.id = l.empresa_id
   where l.ativo and tem_loja(l.id)
   order by e.razao_social, l.codigo
$$;

-- Cor do sistema: a pessoal do usuário, senão a da empresa, senão o azul padrão
create or replace function app_cor_tema()
returns text
language sql stable security definer as $$
  select coalesce(
    (select cor_primaria from preferencias_tema where usuario_id = app_usuario_atual()),
    (select pt.cor_primaria from preferencias_tema pt
       join lojas l on l.empresa_id = pt.empresa_id
       join usuario_lojas ul on ul.loja_id = l.id
      where pt.usuario_id is null and ul.usuario_id = app_usuario_atual()
      limit 1),
    '#0774B8')
$$;

create or replace function app_salvar_cor_tema(p_cor text)
returns void
language sql security definer as $$
  insert into preferencias_tema (usuario_id, cor_primaria)
  values (app_usuario_atual(), p_cor)
  on conflict (usuario_id) where usuario_id is not null
  do update set cor_primaria = excluded.cor_primaria, atualizado_em = now()
$$;
