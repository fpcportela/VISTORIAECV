-- =====================================================================
-- Grupos (empresas) e unidades (lojas).
-- O master (criador do sistema) vê todos os grupos e pode escolher um para
-- trabalhar; os demais usuários só enxergam o próprio grupo.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- Grupo escolhido pelo master no topo da tela (vazio = todos os grupos)
create or replace function grupo_ativo() returns uuid
language sql stable as $$
  select nullif(current_setting('app.grupo', true), '')::uuid
$$;

-- O master enxerga tudo, mas, com um grupo escolhido, só as lojas desse grupo
-- (os vínculos do master com lojas não contam: o que vale é o grupo escolhido)
create or replace function tem_loja(p_loja uuid) returns boolean
language sql stable security definer as $$
  select case when eh_admin_rede()
           then grupo_ativo() is null or exists (select 1 from lojas where id = p_loja and empresa_id = grupo_ativo())
           else exists (select 1 from usuario_lojas where usuario_id = app_usuario_atual() and loja_id = p_loja and ativo) end
$$;

create or replace function tem_empresa(p_empresa uuid) returns boolean
language sql stable security definer as $$
  select case when eh_admin_rede()
           then grupo_ativo() is null or p_empresa = grupo_ativo()
           else exists (select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
                         where ul.usuario_id = app_usuario_atual() and ul.ativo and l.empresa_id = p_empresa) end
$$;

create or replace function pode(p_loja uuid, p_permissao text) returns boolean
language sql stable security definer as $$
  select case when eh_admin_rede()
           then grupo_ativo() is null or exists (select 1 from lojas where id = p_loja and empresa_id = grupo_ativo())
           else exists (select 1 from usuario_lojas ul join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
                         where ul.usuario_id = app_usuario_atual() and ul.loja_id = p_loja and ul.ativo
                           and pp.permissao = p_permissao) end
$$;

-- Deixa um grupo pronto para uso: perfil Administrador, tipos de arquivo,
-- plano de contas padrão e um centro de custo para cada unidade.
create or replace function app_preparar_grupo(p_empresa uuid) returns void
language plpgsql security definer as $$
declare v_perfil uuid;
begin
  if not eh_admin_rede() then
    raise exception 'Só o usuário master pode cadastrar grupos.' using errcode = '42501';
  end if;

  if not exists (select 1 from perfis where empresa_id = p_empresa) then
    insert into perfis (empresa_id, nome, descricao) values (p_empresa, 'Administrador', 'Acesso total')
    returning id into v_perfil;
    insert into perfil_permissoes (perfil_id, permissao) select v_perfil, codigo from permissoes;
  end if;

  insert into tipos_arquivo (empresa_id, nome)
  select p_empresa, t.nome
    from (values ('RG'), ('CPF'), ('CNH'), ('Comprovante de residência'), ('Contrato de trabalho'),
                 ('Carteira de trabalho'), ('ASO (exame admissional)'), ('Atestado médico')) t(nome)
  on conflict do nothing;

  if not exists (select 1 from categorias_financeiras where empresa_id = p_empresa and grupo) then
    insert into categorias_financeiras (empresa_id, tipo, nome, grupo, codigo)
    select p_empresa, g.tipo::tipo_lancamento, g.nome, true, g.codigo
      from (values ('receber', '1', 'Receitas operacionais'), ('receber', '2', 'Outras receitas'),
                   ('pagar', '3', 'Pessoal'), ('pagar', '4', 'Despesas administrativas'),
                   ('pagar', '5', 'Franquia e comercial'), ('pagar', '6', 'Despesas financeiras'),
                   ('pagar', '7', 'Impostos')) g(tipo, codigo, nome)
    on conflict (empresa_id, tipo, nome) do nothing;
    insert into categorias_financeiras (empresa_id, tipo, nome, grupo, codigo, pai_id)
    select p_empresa, c.tipo::tipo_lancamento, c.nome, false, c.codigo, g.id
      from (values
        ('receber', '1.01', 'Receitas de Serviços', '1'), ('receber', '1.02', 'Venda de produtos', '1'),
        ('receber', '2.01', 'Rendimentos financeiros', '2'), ('receber', '2.02', 'Receitas diversas', '2'),
        ('pagar', '3.01', 'Salários', '3'), ('pagar', '3.02', 'Encargos (INSS e FGTS)', '3'),
        ('pagar', '3.03', 'Vale-transporte e alimentação', '3'),
        ('pagar', '4.01', 'Aluguel', '4'), ('pagar', '4.02', 'Água, luz e internet', '4'),
        ('pagar', '4.03', 'Material de escritório', '4'), ('pagar', '4.04', 'Contabilidade', '4'),
        ('pagar', '5.01', 'Royalties', '5'), ('pagar', '5.02', 'Fundo de marketing', '5'), ('pagar', '5.03', 'Publicidade', '5'),
        ('pagar', '6.01', 'Taxas de cartão', '6'), ('pagar', '6.02', 'Tarifas bancárias', '6'), ('pagar', '6.03', 'Juros e multas', '6'),
        ('pagar', '7.01', 'Simples Nacional e ISS', '7')) c(tipo, codigo, nome, grupo_codigo)
      join categorias_financeiras g on g.empresa_id = p_empresa and g.grupo and g.codigo = c.grupo_codigo
    on conflict (empresa_id, tipo, nome) do nothing;
  end if;

  insert into centros_custo (empresa_id, loja_id, nome)
  select l.empresa_id, l.id, l.nome from lojas l
   where l.empresa_id = p_empresa and not exists (select 1 from centros_custo c where c.loja_id = l.id)
  on conflict do nothing;
end $$;

-- Responsáveis que podem aparecer numa venda: quem trabalha em alguma unidade do grupo
create or replace function app_responsaveis(p_empresa uuid)
returns table (id uuid, nome text)
language sql stable security definer as $$
  select distinct u.id, u.nome
    from usuarios u
   where tem_empresa(p_empresa) and u.ativo
     and (u.admin_rede or exists (select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
                                   where ul.usuario_id = u.id and ul.ativo and l.empresa_id = p_empresa))
   order by u.nome
$$;

drop trigger if exists aud_empresas on empresas;
create trigger aud_empresas after insert or update or delete on empresas for each row execute function auditar();
drop trigger if exists aud_lojas on lojas;
create trigger aud_lojas after insert or update or delete on lojas for each row execute function auditar();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update on empresas, lojas to app_api;
    grant select on franquias to app_api;
    grant execute on function grupo_ativo(), app_preparar_grupo(uuid), app_responsaveis(uuid) to app_api;
  end if;
end $$;
