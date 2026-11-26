-- Ponto: comprovante do dia (PDF enviado ao colaborador pelo WhatsApp na saída final)
-- e documentos anexados à justificativa.

create table if not exists ponto_comprovantes (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references colaboradores(id),
  loja_id         uuid not null references lojas(id),
  data            date not null,
  nsr             bigint not null,              -- número sequencial do comprovante no grupo
  hash            text not null,                -- SHA-256 do conteúdo do comprovante
  pdf             bytea not null,
  telefone        text,
  envio           text not null default 'pendente'
                  check (envio in ('pendente', 'enviado', 'simulado', 'sem_celular', 'sem_whatsapp', 'falhou')),
  erro            text,
  criado_em       timestamptz not null default now(),
  unique (colaborador_id, data)
);

create table if not exists ponto_justificativa_arquivos (
  id               uuid primary key default gen_random_uuid(),
  justificativa_id uuid not null references ponto_justificativas(id) on delete cascade,
  nome_arquivo     text not null,
  mime             text not null,
  tamanho          integer not null,
  conteudo         bytea not null,
  enviado_por      uuid references usuarios(id),
  criado_em        timestamptz not null default now()
);
create index if not exists ponto_justificativa_arquivos_j on ponto_justificativa_arquivos(justificativa_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'ponto_comprovantes') then
    alter table ponto_comprovantes enable row level security;
    create policy ponto_comprovantes_por_loja on ponto_comprovantes for all using (tem_loja(loja_id)) with check (tem_loja(loja_id));
    alter table ponto_justificativa_arquivos enable row level security;
    create policy ponto_justificativa_arquivos_por_colab on ponto_justificativa_arquivos for all
      using (exists (select 1 from ponto_justificativas j join colaboradores c on c.id = j.colaborador_id where j.id = justificativa_id))
      with check (exists (select 1 from ponto_justificativas j join colaboradores c on c.id = j.colaborador_id where j.id = justificativa_id));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on ponto_comprovantes, ponto_justificativa_arquivos to app_api;
  end if;
end $$;

-- Número do comprovante (NSR) por grupo
create or replace function app_ponto_nsr(p_loja uuid) returns bigint
language sql security definer as $$
  select proximo_numero((select empresa_id from lojas where id = p_loja), 'ponto_comprovante')
$$;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_ponto_nsr(uuid) to app_api;
  end if;
end $$;
