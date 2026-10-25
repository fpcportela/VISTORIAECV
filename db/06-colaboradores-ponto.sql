-- =====================================================================
-- Colaboradores (cadastro de funcionários) e controle de ponto com foto.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- Colaborador: quem trabalha nas lojas (não precisa ter login no sistema)
create table if not exists colaboradores (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id),
  loja_id         uuid not null references lojas(id),          -- filial onde trabalha
  nome            text not null,
  data_nascimento date,
  cpf             text,                                        -- só números
  celular         text,
  cargo           text,
  ativo           boolean not null default true,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (empresa_id, cpf)
);

-- Tipos de arquivo que o grupo dá nome (RG, CNH, Contrato…)
create table if not exists tipos_arquivo (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id),
  nome        text not null,
  criado_em   timestamptz not null default now()
);
create unique index if not exists tipos_arquivo_nome on tipos_arquivo(empresa_id, lower(nome));

-- Arquivos anexados ao colaborador (guardados no próprio banco)
create table if not exists colaborador_arquivos (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references colaboradores(id) on delete cascade,
  tipo_id         uuid references tipos_arquivo(id) on delete set null,
  nome_arquivo    text not null,
  mime            text not null,
  tamanho         integer not null,
  conteudo        bytea not null,
  observacao      text,
  enviado_por     uuid references usuarios(id),
  enviado_em      timestamptz not null default now()
);
create index if not exists colaborador_arquivos_colab on colaborador_arquivos(colaborador_id);

-- Marcações do ponto. Uma edição nunca apaga: a original fica inativa e a nova aponta para ela.
create table if not exists ponto_registros (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references colaboradores(id),
  loja_id         uuid not null references lojas(id),
  data            date not null,
  tipo            tipo_marcacao_ponto not null,
  hora            timestamptz not null,
  foto            bytea,
  foto_mime       text,
  origem          text not null default 'registro' check (origem in ('registro', 'ajuste')),
  ajuste_de       uuid references ponto_registros(id),
  motivo          text,
  ativo           boolean not null default true,
  registrado_por  uuid references usuarios(id),
  criado_em       timestamptz not null default now(),
  check (origem = 'registro' or motivo is not null)
);
create index if not exists ponto_registros_dia on ponto_registros(colaborador_id, data);
create unique index if not exists ponto_registros_unico on ponto_registros(colaborador_id, data, tipo) where ativo;

-- Justificativa do dia (atestado, folga, esquecimento…)
create table if not exists ponto_justificativas (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references colaboradores(id) on delete cascade,
  data            date not null,
  texto           text not null,
  criado_por      uuid references usuarios(id),
  criado_em       timestamptz not null default now(),
  unique (colaborador_id, data)
);

-- Acesso: colaboradores e ponto pela loja; tipos de arquivo pelo grupo; arquivos e justificativas pelo colaborador
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'colaboradores') then
    alter table colaboradores enable row level security;
    create policy colaboradores_por_loja on colaboradores for all using (tem_loja(loja_id)) with check (tem_loja(loja_id));
    alter table ponto_registros enable row level security;
    create policy ponto_registros_por_loja on ponto_registros for all using (tem_loja(loja_id)) with check (tem_loja(loja_id));
    alter table tipos_arquivo enable row level security;
    create policy tipos_arquivo_por_empresa on tipos_arquivo for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
    alter table colaborador_arquivos enable row level security;
    create policy colaborador_arquivos_por_colab on colaborador_arquivos for all
      using (exists (select 1 from colaboradores c where c.id = colaborador_id))
      with check (exists (select 1 from colaboradores c where c.id = colaborador_id));
    alter table ponto_justificativas enable row level security;
    create policy ponto_justificativas_por_colab on ponto_justificativas for all
      using (exists (select 1 from colaboradores c where c.id = colaborador_id))
      with check (exists (select 1 from colaboradores c where c.id = colaborador_id));
  end if;
end $$;

-- Auditoria e atualizado_em
drop trigger if exists aud_colaboradores on colaboradores;
create trigger aud_colaboradores after insert or update or delete on colaboradores for each row execute function auditar();
drop trigger if exists aud_ponto_registros on ponto_registros;
create trigger aud_ponto_registros after insert or update or delete on ponto_registros for each row execute function auditar();
drop trigger if exists aud_ponto_justificativas on ponto_justificativas;
create trigger aud_ponto_justificativas after insert or update or delete on ponto_justificativas for each row execute function auditar();
drop trigger if exists upd_colaboradores on colaboradores;
create trigger upd_colaboradores before update on colaboradores for each row execute function set_atualizado_em();

-- Permissões
insert into permissoes (codigo, modulo, descricao, nivel) values
  ('colaboradores.ver',    'Colaboradores',     'Ver colaboradores e seus arquivos', 'consulta'),
  ('colaboradores.editar', 'Colaboradores',     'Cadastrar colaboradores e anexar arquivos', 'uso'),
  ('ponto.justificar',     'Controle de ponto', 'Justificar faltas e atrasos', 'uso')
on conflict (codigo) do nothing;
update permissoes set descricao = 'Registrar o ponto (com foto)' where codigo = 'ponto.registrar';
update permissoes set descricao = 'Ver o espelho de ponto dos colaboradores' where codigo = 'ponto.ver_equipe';
update permissoes set descricao = 'Editar e incluir marcações (com motivo)' where codigo = 'ponto.ajustar';

-- Tipos de arquivo sugeridos para cada grupo
insert into tipos_arquivo (empresa_id, nome)
select e.id, t.nome
  from empresas e
  cross join (values ('RG'), ('CPF'), ('CNH'), ('Comprovante de residência'), ('Contrato de trabalho'),
                     ('Carteira de trabalho'), ('ASO (exame admissional)'), ('Atestado médico')) t(nome)
on conflict do nothing;

-- A API (app_api) precisa ler e gravar as tabelas novas
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on colaboradores, tipos_arquivo, colaborador_arquivos,
          ponto_registros, ponto_justificativas to app_api;
  end if;
end $$;
