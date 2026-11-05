-- Preço do item na venda vem travado (tabela do serviço ou preço especial do cliente).
-- Alterar exige o e-mail e a senha de quem pode autorizar (mesma permissão do desconto).

create or replace function app_autorizar_preco(p_loja uuid, p_email text, p_senha text)
returns uuid
language plpgsql security definer as $$
declare v_autorizador uuid;
begin
  select u.id into v_autorizador
    from usuarios u
   where lower(u.email) = lower(trim(coalesce(p_email, ''))) and u.ativo
     and u.senha_hash = crypt(coalesce(p_senha, ''), u.senha_hash)
     and (u.admin_rede or exists (
           select 1 from usuario_lojas ul
             join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
            where ul.usuario_id = u.id and ul.loja_id = p_loja and ul.ativo
              and pp.permissao = 'vendas.desconto'));
  if v_autorizador is null then
    raise exception 'Alteração de preço não autorizada: e-mail ou senha incorretos, ou a pessoa não pode autorizar.' using errcode = '22023';
  end if;
  return v_autorizador;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_autorizar_preco(uuid, text, text) to app_api;
  end if;
end $$;
