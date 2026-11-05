-- Financeiro: documentos anexados aos lançamentos (com nome dado por quem anexa)
-- e competência sempre no primeiro dia do mês (a tela usa só MM/AAAA).

create table if not exists lancamento_arquivos (
  id             uuid primary key default gen_random_uuid(),
  lancamento_id  uuid not null references lancamentos(id) on delete cascade,
  nome           text not null,          -- nome que a pessoa deu (ex.: NOTA FISCAL, BOLETO)
  nome_arquivo   text not null,          -- nome original do arquivo
  mime           text not null,
  tamanho        integer not null,
  conteudo       bytea not null,
  enviado_por    uuid references usuarios(id),
  criado_em      timestamptz not null default now()
);
create index if not exists lancamento_arquivos_l on lancamento_arquivos(lancamento_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'lancamento_arquivos') then
    alter table lancamento_arquivos enable row level security;
    create policy lancamento_arquivos_por_lancamento on lancamento_arquivos for all
      using (exists (select 1 from lancamentos l where l.id = lancamento_id))
      with check (exists (select 1 from lancamentos l where l.id = lancamento_id));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on lancamento_arquivos to app_api;
    grant select, insert, update on contas_financeiras to app_api;
  end if;
end $$;

-- competências antigas passam para o primeiro dia do mês
update lancamentos set competencia = date_trunc('month', competencia)::date
 where competencia is not null and extract(day from competencia) <> 1;
