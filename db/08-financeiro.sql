-- =====================================================================
-- Contas a pagar e a receber: plano de contas (grupos e categorias de
-- receitas e despesas) e centros de custo. Pode rodar de novo sem problema.
-- =====================================================================

-- Plano de contas: grupos (ex.: 4 Despesas administrativas) e categorias dentro deles (4.01 Aluguel)
alter table categorias_financeiras add column if not exists grupo boolean not null default false;
alter table categorias_financeiras add column if not exists codigo text;

-- Centros de custo do grupo (por padrão um para cada loja; dá para criar outros)
create table if not exists centros_custo (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id),
  loja_id     uuid references lojas(id),
  nome        text not null,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);
create unique index if not exists centros_custo_nome on centros_custo(empresa_id, lower(nome));

alter table lancamentos add column if not exists centro_custo_id uuid references centros_custo(id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'centros_custo') then
    alter table centros_custo enable row level security;
    create policy centros_custo_por_empresa on centros_custo for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
  end if;
end $$;

-- Plano de contas padrão em cada grupo (só cria o que ainda não existe)
create temp table plano_padrao (tipo tipo_lancamento, codigo text, nome text, grupo_nome text);
insert into plano_padrao values
  ('receber', '1',    'Receitas operacionais',            null),
  ('receber', '1.01', 'Receitas de Serviços',             'Receitas operacionais'),
  ('receber', '1.02', 'Venda de produtos',                'Receitas operacionais'),
  ('receber', '2',    'Outras receitas',                  null),
  ('receber', '2.01', 'Rendimentos financeiros',          'Outras receitas'),
  ('receber', '2.02', 'Receitas diversas',                'Outras receitas'),
  ('pagar',   '3',    'Pessoal',                          null),
  ('pagar',   '3.01', 'Salários',                         'Pessoal'),
  ('pagar',   '3.02', 'Encargos (INSS e FGTS)',           'Pessoal'),
  ('pagar',   '3.03', 'Vale-transporte e alimentação',    'Pessoal'),
  ('pagar',   '4',    'Despesas administrativas',         null),
  ('pagar',   '4.01', 'Aluguel',                          'Despesas administrativas'),
  ('pagar',   '4.02', 'Água, luz e internet',             'Despesas administrativas'),
  ('pagar',   '4.03', 'Material de escritório',           'Despesas administrativas'),
  ('pagar',   '4.04', 'Contabilidade',                    'Despesas administrativas'),
  ('pagar',   '5',    'Franquia e comercial',             null),
  ('pagar',   '5.01', 'Royalties',                        'Franquia e comercial'),
  ('pagar',   '5.02', 'Fundo de marketing',               'Franquia e comercial'),
  ('pagar',   '5.03', 'Publicidade',                      'Franquia e comercial'),
  ('pagar',   '6',    'Despesas financeiras',             null),
  ('pagar',   '6.01', 'Taxas de cartão',                  'Despesas financeiras'),
  ('pagar',   '6.02', 'Tarifas bancárias',                'Despesas financeiras'),
  ('pagar',   '6.03', 'Juros e multas',                   'Despesas financeiras'),
  ('pagar',   '7',    'Impostos',                         null),
  ('pagar',   '7.01', 'Simples Nacional e ISS',           'Impostos');

-- grupos
insert into categorias_financeiras (empresa_id, tipo, nome, grupo, codigo)
select e.id, p.tipo, p.nome, true, p.codigo
  from empresas e cross join plano_padrao p
 where p.grupo_nome is null
   and not exists (select 1 from categorias_financeiras c where c.empresa_id = e.id and c.grupo)
on conflict (empresa_id, tipo, nome) do nothing;

-- categorias: as que já existem (ex.: Aluguel) entram no grupo certo; as que faltam são criadas
insert into categorias_financeiras (empresa_id, tipo, nome, grupo, codigo, pai_id)
select e.id, p.tipo, p.nome, false, p.codigo, g.id
  from empresas e
  join plano_padrao p on p.grupo_nome is not null
  join categorias_financeiras g on g.empresa_id = e.id and g.tipo = p.tipo and g.nome = p.grupo_nome and g.grupo
on conflict (empresa_id, tipo, nome) do update
  set pai_id = coalesce(categorias_financeiras.pai_id, excluded.pai_id),
      codigo = coalesce(categorias_financeiras.codigo, excluded.codigo);

-- categorias antigas sem grupo vão para "Receitas diversas" / "Despesas administrativas"
update categorias_financeiras c
   set pai_id = g.id
  from categorias_financeiras g
 where c.pai_id is null and not c.grupo and g.empresa_id = c.empresa_id and g.grupo and g.tipo = c.tipo
   and g.nome = case c.tipo when 'receber' then 'Outras receitas' else 'Despesas administrativas' end;

drop table plano_padrao;

-- um centro de custo para cada loja
insert into centros_custo (empresa_id, loja_id, nome)
select l.empresa_id, l.id, l.nome from lojas l
 where not exists (select 1 from centros_custo c where c.loja_id = l.id)
on conflict do nothing;

-- Permissão para configurar o plano de contas e os centros de custo
insert into permissoes (codigo, modulo, descricao, nivel) values
  ('financeiro.plano', 'Financeiro', 'Configurar plano de contas e centros de custo', 'uso')
on conflict (codigo) do nothing;
update permissoes set descricao = 'Ver contas a pagar e a receber' where codigo = 'financeiro.ver';
update permissoes set descricao = 'Lançar contas, receber e pagar' where codigo = 'financeiro.lancar';
update permissoes set descricao = 'Excluir lançamentos e desfazer pagamentos' where codigo = 'financeiro.excluir';

drop trigger if exists aud_centros_custo on centros_custo;
create trigger aud_centros_custo after insert or update or delete on centros_custo for each row execute function auditar();
drop trigger if exists aud_categorias on categorias_financeiras;
create trigger aud_categorias after insert or update or delete on categorias_financeiras for each row execute function auditar();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on centros_custo to app_api;
  end if;
end $$;
