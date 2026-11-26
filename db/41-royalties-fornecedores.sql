-- =====================================================================
-- Royalties: cadastro de fornecedores, cada um com o valor que recebe por
-- serviço vendido (igual aos preços especiais do cliente), e o relatório que
-- soma os serviços vendidos no período e gera a conta a pagar.
-- Substitui a apuração mensal por % (regras_royalty / calcular_royalty), que
-- não chegou a ser usada; as tabelas antigas ficam no banco, sem uso.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

alter table fornecedores add column if not exists tipo text not null default 'pj' check (tipo in ('pf', 'pj'));
alter table fornecedores add column if not exists nome_fantasia text;
alter table fornecedores add column if not exists whatsapp text;
alter table fornecedores add column if not exists cep text;
alter table fornecedores add column if not exists endereco text;
alter table fornecedores add column if not exists cidade text;
alter table fornecedores add column if not exists uf char(2);
alter table fornecedores add column if not exists chave_pix text;
alter table fornecedores add column if not exists observacoes text;
-- o que já vem marcado ao gerar a conta a pagar deste fornecedor
alter table fornecedores add column if not exists categoria_id uuid references categorias_financeiras(id);
alter table fornecedores add column if not exists centro_custo_id uuid references centros_custo(id);
alter table fornecedores add column if not exists dia_vencimento smallint check (dia_vencimento between 1 and 31);
create unique index if not exists fornecedores_doc on fornecedores(empresa_id, cpf_cnpj) where cpf_cnpj is not null;

-- Valor pago ao fornecedor por unidade de cada serviço vendido
create table if not exists fornecedor_precos (
  fornecedor_id uuid not null references fornecedores(id) on delete cascade,
  servico_id    uuid not null references servicos(id) on delete cascade,
  valor         numeric(12,2) not null check (valor >= 0),
  primary key (fornecedor_id, servico_id)
);

-- Itens de venda que já entraram numa conta a pagar do fornecedor (cada item só uma vez por fornecedor)
create table if not exists royalty_itens (
  lancamento_id  uuid not null references lancamentos(id) on delete cascade,
  fornecedor_id  uuid not null references fornecedores(id),
  venda_item_id  uuid not null references venda_itens(id) on delete cascade,
  valor          numeric(12,2) not null,
  primary key (fornecedor_id, venda_item_id)
);
create index if not exists royalty_itens_lancamento on royalty_itens(lancamento_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'fornecedor_precos') then
    alter table fornecedor_precos enable row level security;
    create policy fornecedor_precos_fornecedor on fornecedor_precos for all
      using (exists (select 1 from fornecedores f where f.id = fornecedor_id))
      with check (exists (select 1 from fornecedores f where f.id = fornecedor_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'royalty_itens') then
    alter table royalty_itens enable row level security;
    create policy royalty_itens_por_lancamento on royalty_itens for all
      using (exists (select 1 from lancamentos l where l.id = lancamento_id))
      with check (exists (select 1 from lancamentos l where l.id = lancamento_id));
  end if;
end $$;

-- Conta a pagar cancelada: os serviços voltam a aparecer como pendentes no relatório
create or replace function liberar_royalty_itens() returns trigger
language plpgsql security definer as $$
begin
  if new.status = 'cancelado' and old.status <> 'cancelado' then
    delete from royalty_itens where lancamento_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_liberar_royalty_itens on lancamentos;
create trigger trg_liberar_royalty_itens after update of status on lancamentos
  for each row execute function liberar_royalty_itens();

update permissoes set descricao = 'Ver o relatório de royalties' where codigo = 'royalties.ver';
update permissoes set descricao = 'Gerar a conta a pagar dos royalties' where codigo = 'royalties.fechar';
update permissoes set descricao = 'Cadastrar fornecedores e os valores por serviço' where codigo = 'royalties.configurar';

drop trigger if exists aud_fornecedores on fornecedores;
create trigger aud_fornecedores after insert or update or delete on fornecedores for each row execute function auditar();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on fornecedores, fornecedor_precos, royalty_itens to app_api;
  end if;
end $$;
