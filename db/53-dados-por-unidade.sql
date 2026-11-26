-- =====================================================================
-- Grupos e unidades: em cada área do sistema o grupo escolhe se os dados são
-- de TODAS as unidades do grupo (compartilhado) ou SEPARADOS por unidade.
--   vendas         compartilhado: quem vê vendas numa unidade vê as vendas de todas as unidades do grupo
--   clientes       separado: cada unidade tem a sua carteira (o cliente fica na unidade onde foi cadastrado)
--   relatorios     compartilhado: os relatórios juntam vendas e financeiro de todas as unidades do grupo
--   colaboradores  compartilhado: quem vê colaboradores numa unidade vê os de todas as unidades do grupo
-- O padrão é como o sistema já funcionava: clientes compartilhados; vendas, relatórios e
-- colaboradores separados. Compartilhar libera só a CONSULTA: alterar continua exigindo a
-- permissão na unidade dona do dado.
-- O cliente ganha a unidade onde foi cadastrado (o número da filial aparece no cadastro).
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

alter table empresas add column if not exists compartilha_vendas        boolean not null default false;
alter table empresas add column if not exists compartilha_clientes      boolean not null default true;
alter table empresas add column if not exists compartilha_relatorios    boolean not null default false;
alter table empresas add column if not exists compartilha_colaboradores boolean not null default false;

-- Unidade onde o cliente foi cadastrado (o avulso é do grupo todo e fica sem unidade)
alter table clientes add column if not exists loja_id uuid references lojas(id);
create index if not exists clientes_loja on clientes(loja_id);

-- Clientes antigos (e os criados pelo robô ou pela agenda): a unidade da primeira venda,
-- senão a primeira unidade do grupo
update clientes c
   set loja_id = coalesce(
         (select v.loja_id from vendas v where v.cliente_id = c.id order by v.criado_em limit 1),
         (select l.id from lojas l where l.empresa_id = c.empresa_id order by l.codigo limit 1))
 where c.loja_id is null and c.tipo::text <> 'avulso';

-- CPF/CNPJ único por unidade. Com clientes compartilhados a API ainda procura no grupo
-- inteiro antes de cadastrar (nunca duplica); separados, cada unidade pode ter o seu.
drop index if exists clientes_doc;
create unique index if not exists clientes_doc_loja on clientes(empresa_id, loja_id, cpf_cnpj) nulls not distinct
  where cpf_cnpj is not null;

-- Cliente criado sem unidade (robô do WhatsApp, agenda) fica na unidade da primeira venda dele
create or replace function trg_cliente_loja_da_venda() returns trigger language plpgsql security definer as $$
begin
  update clientes set loja_id = new.loja_id
   where id = new.cliente_id and loja_id is null and tipo::text <> 'avulso';
  return null;
end $$;
drop trigger if exists cliente_loja_da_venda on vendas;
create trigger cliente_loja_da_venda after insert on vendas for each row execute function trg_cliente_loja_da_venda();

-- A área está compartilhada entre as unidades do grupo?
create or replace function compartilha(p_empresa uuid, p_area text) returns boolean
language sql stable security definer as $$
  select coalesce((select case p_area when 'vendas' then compartilha_vendas
                                      when 'clientes' then compartilha_clientes
                                      when 'relatorios' then compartilha_relatorios
                                      when 'colaboradores' then compartilha_colaboradores end
                     from empresas where id = p_empresa), false)
$$;

-- Pode CONSULTAR os dados da unidade X nesta área? Tem a permissão na própria unidade, ou a
-- área é compartilhada no grupo e tem a permissão em alguma unidade do mesmo grupo.
create or replace function pode_ver(p_loja uuid, p_area text, p_permissao text) returns boolean
language sql stable security definer as $$
  select pode(p_loja, p_permissao) or exists (
    select 1 from lojas l join lojas o on o.empresa_id = l.empresa_id
     where l.id = p_loja and compartilha(l.empresa_id, p_area) and pode(o.id, p_permissao))
$$;

-- Linha de uma unidade do grupo da pessoa, numa área compartilhada (usada pelas regras de leitura)
create or replace function loja_compartilhada(p_loja uuid, p_areas text[]) returns boolean
language sql stable security definer as $$
  select exists (select 1 from lojas l
                  where l.id = p_loja and tem_empresa(l.empresa_id)
                    and exists (select 1 from unnest(p_areas) a where compartilha(l.empresa_id, a)))
$$;

-- Nome e número da unidade e nome do usuário de outra unidade do mesmo grupo (as regras de
-- acesso às lojas e aos usuários continuam mostrando só as unidades da pessoa)
create or replace function loja_nome(p_loja uuid) returns text
language sql stable security definer as $$
  select nome from lojas where id = p_loja and tem_empresa(empresa_id)
$$;
create or replace function loja_codigo(p_loja uuid) returns text
language sql stable security definer as $$
  select codigo from lojas where id = p_loja and tem_empresa(empresa_id)
$$;
create or replace function usuario_nome(p_usuario uuid) returns text
language sql stable security definer as $$
  select u.nome from usuarios u
   where u.id = p_usuario
     and (u.admin_rede or exists (select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
                                   where ul.usuario_id = u.id and tem_empresa(l.empresa_id)))
$$;

-- Leitura a mais (as regras antigas de alterar continuam valendo só para a própria unidade)
drop policy if exists vendas_compartilhadas on vendas;
create policy vendas_compartilhadas on vendas for select
  using (loja_compartilhada(loja_id, array['vendas', 'relatorios']));
drop policy if exists lancamentos_compartilhados on lancamentos;
create policy lancamentos_compartilhados on lancamentos for select
  using (loja_compartilhada(loja_id, array['relatorios']));
drop policy if exists colaboradores_compartilhados on colaboradores;
create policy colaboradores_compartilhados on colaboradores for select
  using (loja_compartilhada(loja_id, array['colaboradores']));
drop policy if exists colaborador_lojas_compartilhadas on colaborador_lojas;
create policy colaborador_lojas_compartilhadas on colaborador_lojas for select
  using (loja_compartilhada(loja_id, array['colaboradores']));

-- Colaborador: consulta com a área compartilhada; alterar segue pode_colaborador
create or replace function pode_ver_colaborador(p_colaborador uuid, p_permissao text) returns boolean
language sql stable security definer as $$
  select pode_colaborador(p_colaborador, p_permissao)
      or exists (select 1 from colaboradores where id = p_colaborador and pode_ver(loja_id, 'colaboradores', p_permissao))
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function compartilha(uuid, text), pode_ver(uuid, text, text), loja_compartilhada(uuid, text[]),
                              pode_ver_colaborador(uuid, text), loja_nome(uuid), loja_codigo(uuid), usuario_nome(uuid) to app_api;
  end if;
end $$;
