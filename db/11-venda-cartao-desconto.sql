-- =====================================================================
-- Venda: CV e bandeira no pagamento com cartão; desconto só com a senha de
-- quem pode autorizar (master ou perfil com "Dar desconto", ex.: Sênior/Administrador).
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

alter table venda_pagamentos add column if not exists cv text;        -- comprovante de venda da maquininha
alter table venda_pagamentos add column if not exists bandeira text;  -- Visa, Mastercard, Elo…

update permissoes set descricao = 'Autorizar desconto (com a própria senha)' where codigo = 'vendas.desconto';

-- Confere e-mail e senha de quem autoriza o desconto numa loja. Devolve o id de quem autorizou.
create or replace function app_autorizar_desconto(p_loja uuid, p_email text, p_senha text)
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
    raise exception 'Desconto não autorizado: e-mail ou senha incorretos, ou a pessoa não pode autorizar desconto.' using errcode = '22023';
  end if;
  return v_autorizador;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_autorizar_desconto(uuid, text, text) to app_api;
  end if;
end $$;
