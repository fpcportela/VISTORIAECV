-- Permissão para trocar o responsável da venda (escolhido entre os colaboradores ativos da unidade
-- que têm acesso ao sistema). Sai ligada para os perfis que já autorizam alteração de venda.
insert into permissoes (codigo, modulo, descricao, nivel) values
  ('vendas.responsavel', 'Vendas', 'Trocar o responsável da venda', 'uso')
on conflict (codigo) do nothing;
insert into perfil_permissoes (perfil_id, permissao)
select pp.perfil_id, 'vendas.responsavel' from perfil_permissoes pp where pp.permissao = 'vendas.autorizar'
on conflict do nothing;

-- Colaboradores ativos da unidade (principal ou extra) com usuário ativo
create or replace function app_responsaveis_loja(p_loja uuid)
returns table (id uuid, nome text)
language sql stable security definer as $$
  select distinct u.id, u.nome
    from colaboradores c join usuarios u on u.id = c.usuario_id
   where tem_loja(p_loja) and c.ativo and u.ativo
     and (c.loja_id = p_loja or exists (select 1 from colaborador_lojas cl where cl.colaborador_id = c.id and cl.loja_id = p_loja))
   order by u.nome
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_responsaveis_loja(uuid) to app_api;
  end if;
end $$;
