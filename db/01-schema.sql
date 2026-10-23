-- =====================================================================
-- VISTORIA ECV · ERP para franquias de vistoria cautelar
-- Banco de dados PostgreSQL 16 (roda no PC com Docker e em servidor VPS)
-- Versão 1 · 2026-10-23
--
-- Organização:
--   1. Estrutura da rede: franquia > empresas (franqueados) > lojas
--   2. Usuários, perfis e permissões configuráveis por loja
--   3. Tema (cor do sistema)
--   4. Clientes, fornecedores e veículos (consulta de placa / OCR)
--   5. Serviços, vendas e numeração própria
--   6. Vistorias (checklist, fotos, laudo)
--   7. Financeiro: contas, categorias, contas a pagar e receber
--   8. Maquininhas, transações de cartão e extrato bancário
--   9. Royalties
--  10. Controle de ponto
--  11. WhatsApp e auditoria
--  12. Segurança (RLS): cada usuário só vê as lojas a que tem acesso
-- =====================================================================

create extension if not exists pgcrypto;

-- Usuário logado na requisição atual. A API define app.usuario_id
-- no início de cada transação (set_config(..., true)).
create or replace function app_usuario_atual() returns uuid
language sql stable as $$
  select nullif(current_setting('app.usuario_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type tipo_veiculo        as enum ('carro', 'moto', 'caminhao', 'outro');
create type tipo_pessoa         as enum ('pf', 'pj', 'avulso');
create type tipo_venda          as enum ('orcamento', 'venda_avulsa');
create type situacao_venda      as enum ('em_aberto', 'aprovado', 'cancelado');
create type status_vistoria     as enum ('agendada', 'em_andamento', 'concluida', 'cancelada');
create type resultado_vistoria  as enum ('aprovado', 'aprovado_com_apontamentos', 'reprovado');
create type situacao_item       as enum ('conforme', 'nao_conforme', 'nao_se_aplica');
create type tipo_lancamento     as enum ('receber', 'pagar');
create type status_lancamento   as enum ('em_aberto', 'pago_parcial', 'pago', 'cancelado');
create type forma_pagamento     as enum ('dinheiro', 'pix', 'cartao_credito', 'cartao_debito', 'boleto', 'transferencia', 'faturado');
create type tipo_conta_fin      as enum ('caixa', 'conta_corrente', 'poupanca', 'adquirente');
create type modalidade_cartao   as enum ('credito', 'debito', 'pix', 'voucher');
create type status_transacao    as enum ('aprovada', 'cancelada', 'estornada', 'chargeback');
create type base_royalty        as enum ('faturamento_bruto', 'faturamento_liquido', 'valor_fixo');
create type status_apuracao     as enum ('rascunho', 'fechada', 'faturada', 'paga');
create type tipo_marcacao_ponto as enum ('entrada', 'saida_intervalo', 'volta_intervalo', 'saida');
create type origem_consulta     as enum ('api_placas', 'cache', 'ocr_foto', 'manual');

-- Função padrão para atualizar o campo atualizado_em
create or replace function set_atualizado_em() returns trigger
language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- =====================================================================
-- 1. Estrutura da rede
-- =====================================================================
create table franquias (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  cnpj          text unique,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Franqueado (dono de uma ou mais lojas)
create table empresas (
  id            uuid primary key default gen_random_uuid(),
  franquia_id   uuid not null references franquias(id),
  razao_social  text not null,
  nome_fantasia text,
  cnpj          text unique,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table lojas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id),
  codigo         text not null,                 -- ex.: 0001 (usado como centro de custo)
  nome           text not null,                 -- ex.: Loja 1 · Unidade 1
  cnpj           text,
  telefone       text,
  whatsapp       text,
  cep            text,
  logradouro     text,
  numero         text,
  bairro         text,
  cidade         text,
  uf             char(2),
  latitude       numeric(9,6),                  -- usado para validar o ponto
  longitude      numeric(9,6),
  raio_ponto_m   integer default 200,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (empresa_id, codigo)
);

-- =====================================================================
-- 2. Usuários, perfis e permissões
-- =====================================================================
create table usuarios (
  id            uuid primary key default gen_random_uuid(),
  senha_hash    text not null,                  -- bcrypt (pgcrypto crypt)
  nome          text not null,
  email         text not null unique,
  cpf           text unique,
  telefone      text,
  ativo         boolean not null default true,
  -- administrador da franqueadora vê toda a rede
  admin_rede    boolean not null default false,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Catálogo fixo de permissões do sistema (preenchido no final do script)
create table permissoes (
  codigo    text primary key,                   -- ex.: vistorias.criar
  modulo    text not null,                      -- ex.: Vistorias
  descricao text not null
);

-- Perfis configuráveis por empresa (ex.: Vistoriador, Caixa, Gerente)
create table perfis (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  nome       text not null,
  descricao  text,
  criado_em  timestamptz not null default now(),
  unique (empresa_id, nome)
);

create table perfil_permissoes (
  perfil_id uuid not null references perfis(id) on delete cascade,
  permissao text not null references permissoes(codigo),
  primary key (perfil_id, permissao)
);

-- Um usuário pode trabalhar em várias lojas, com um perfil em cada uma
create table usuario_lojas (
  usuario_id uuid not null references usuarios(id) on delete cascade,
  loja_id    uuid not null references lojas(id) on delete cascade,
  perfil_id  uuid not null references perfis(id),
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now(),
  primary key (usuario_id, loja_id)
);

-- =====================================================================
-- 3. Tema (cor do sistema escolhida na paleta)
-- =====================================================================
create table preferencias_tema (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid references empresas(id) on delete cascade,  -- padrão da empresa
  usuario_id  uuid references usuarios(id) on delete cascade,  -- ou escolha pessoal
  cor_primaria text not null default '#0774B8' check (cor_primaria ~ '^#[0-9A-Fa-f]{6}$'),
  atualizado_em timestamptz not null default now(),
  check (empresa_id is not null or usuario_id is not null)
);
create unique index preferencias_tema_empresa on preferencias_tema(empresa_id) where usuario_id is null;

-- Atalhos que cada usuário escolheu para a tela inicial (computador e celular).
-- null = ainda não escolheu: aparecem todos os módulos liberados no perfil.
create table usuario_atalhos (
  usuario_id    uuid primary key references usuarios(id) on delete cascade,
  atalhos       text[] not null default '{}',
  atualizado_em timestamptz not null default now()
);
create unique index preferencias_tema_usuario on preferencias_tema(usuario_id) where usuario_id is not null;

-- =====================================================================
-- 4. Clientes, fornecedores e veículos
-- =====================================================================
create table clientes (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id),
  tipo          tipo_pessoa not null,
  nome          text not null,                  -- avulso: "CLIENTE PARTICULAR / AVULSO"
  cpf_cnpj      text,
  telefone      text,
  whatsapp      text,
  email         text,
  cep           text,
  endereco      text,
  cidade        text,
  uf            char(2),
  consulta_serasa jsonb,                        -- última consulta ao Serasa
  serasa_consultado_em timestamptz,
  observacoes   text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (tipo = 'avulso' or cpf_cnpj is not null)
);
create unique index clientes_doc on clientes(empresa_id, cpf_cnpj) where cpf_cnpj is not null;

create table fornecedores (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id),
  nome          text not null,
  cpf_cnpj      text,
  telefone      text,
  email         text,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

-- Veículo identificado pela placa (dados vindos da API Placas ou digitados)
create table veiculos (
  id              uuid primary key default gen_random_uuid(),
  placa           text not null unique check (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  tipo            tipo_veiculo not null default 'carro',
  marca           text,
  modelo          text,
  versao          text,
  ano_fabricacao  smallint,
  ano_modelo      smallint,
  cor             text,
  combustivel     text,
  chassi          text,
  renavam         text,
  motor           text,
  municipio       text,
  uf              char(2),
  dados_consulta  jsonb,                        -- resposta completa da última consulta
  consultado_em   timestamptz,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now()
);

-- Histórico de consultas de placa (API Placas, cache local, leitura por foto ou digitação)
create table consultas_placa (
  id           uuid primary key default gen_random_uuid(),
  loja_id      uuid not null references lojas(id),
  usuario_id   uuid references usuarios(id),
  placa        text not null,
  origem       origem_consulta not null,
  foto_path    text,                            -- foto usada no OCR (storage)
  confianca_ocr numeric(5,2),
  sucesso      boolean not null,
  resposta     jsonb,
  veiculo_id   uuid references veiculos(id),
  criado_em    timestamptz not null default now()
);

-- =====================================================================
-- 5. Serviços, vendas e numeração própria
-- =====================================================================
create table servicos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id),
  nome         text not null,                   -- ex.: ECV, Cautelar, Pesquisa
  descricao    text,
  gera_vistoria boolean not null default true,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),
  unique (empresa_id, nome)
);

-- Preço por tipo de veículo e, se preciso, por loja
create table servico_precos (
  id           uuid primary key default gen_random_uuid(),
  servico_id   uuid not null references servicos(id) on delete cascade,
  loja_id      uuid references lojas(id),       -- null = vale para todas as lojas
  tipo_veiculo tipo_veiculo not null,
  valor        numeric(12,2) not null check (valor >= 0)
);
create unique index servico_precos_unq on servico_precos(servico_id, coalesce(loja_id, '00000000-0000-0000-0000-000000000000'::uuid), tipo_veiculo);

-- Contadores próprios (não editáveis) por grupo/empresa: todas as lojas do
-- mesmo grupo compartilham a sequência de vendas e de vistorias.
-- Cada grupo começa do zero: a primeira venda é a nº 1.
create table contadores (
  empresa_id uuid not null references empresas(id),
  tipo       text not null,
  ultimo     bigint not null default 0,
  primary key (empresa_id, tipo)
);

create or replace function proximo_numero(p_empresa uuid, p_tipo text) returns bigint
language plpgsql security definer as $$
declare n bigint;
begin
  insert into contadores (empresa_id, tipo, ultimo) values (p_empresa, p_tipo, 1)
  on conflict (empresa_id, tipo) do update set ultimo = contadores.ultimo + 1
  returning ultimo into n;
  return n;
end $$;

-- Preenche empresa_id (pela loja) e o próximo número do grupo
create or replace function numerar_por_grupo() returns trigger
language plpgsql as $$
begin
  select empresa_id into new.empresa_id from lojas where id = new.loja_id;
  new.numero := proximo_numero(new.empresa_id, tg_argv[0]);
  return new;
end $$;

create table categorias_financeiras (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id),
  pai_id      uuid references categorias_financeiras(id),
  tipo        tipo_lancamento not null,         -- receber = receita, pagar = despesa
  nome        text not null,                    -- ex.: Receitas de Serviços
  ativo       boolean not null default true,
  unique (empresa_id, tipo, nome)
);

create table vendas (
  id               uuid primary key default gen_random_uuid(),
  loja_id          uuid not null references lojas(id),   -- também é o centro de custo
  empresa_id       uuid not null references empresas(id), -- grupo (preenchido pela loja)
  numero           bigint not null,
  tipo             tipo_venda not null default 'venda_avulsa',
  situacao         situacao_venda not null default 'aprovado',
  cliente_id       uuid not null references clientes(id),
  data_venda       date not null default current_date,
  categoria_id     uuid references categorias_financeiras(id),
  vendedor_id      uuid references usuarios(id),
  valor_bruto      numeric(12,2) not null default 0,
  desconto         numeric(12,2) not null default 0,
  valor_total      numeric(12,2) generated always as (valor_bruto - desconto) stored,
  observacoes      text,
  nfse_numero      text,
  nfse_status      text,
  criado_por       uuid references usuarios(id),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (empresa_id, numero)
);

create trigger trg_vendas_numero before insert on vendas
  for each row execute function numerar_por_grupo('venda');

create table venda_itens (
  id           uuid primary key default gen_random_uuid(),
  venda_id     uuid not null references vendas(id) on delete cascade,
  servico_id   uuid not null references servicos(id),
  veiculo_id   uuid references veiculos(id),
  descricao    text,                            -- ex.: VW SAVEIRO // GID4G99
  quantidade   numeric(10,2) not null default 1 check (quantidade > 0),
  valor_unit   numeric(12,2) not null check (valor_unit >= 0),
  valor_total  numeric(12,2) generated always as (quantidade * valor_unit) stored
);

-- Recalcula o valor bruto da venda quando os itens mudam
create or replace function vendas_recalcular() returns trigger
language plpgsql as $$
declare v uuid := coalesce(new.venda_id, old.venda_id);
begin
  update vendas set valor_bruto = coalesce((select sum(valor_total) from venda_itens where venda_id = v), 0)
  where id = v;
  return null;
end $$;
create trigger trg_venda_itens_total after insert or update or delete on venda_itens
  for each row execute function vendas_recalcular();

-- =====================================================================
-- 6. Vistorias
-- =====================================================================
-- Modelo de checklist (itens a verificar) por empresa e tipo de veículo
create table checklist_modelos (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id),
  nome         text not null,
  tipo_veiculo tipo_veiculo,
  ativo        boolean not null default true
);

create table checklist_modelo_itens (
  id        uuid primary key default gen_random_uuid(),
  modelo_id uuid not null references checklist_modelos(id) on delete cascade,
  grupo     text,                               -- ex.: Estrutura, Identificação, Pintura
  descricao text not null,                      -- ex.: Numeração do chassi
  ordem     integer not null default 0,
  exige_foto boolean not null default false
);

create table vistorias (
  id              uuid primary key default gen_random_uuid(),
  loja_id         uuid not null references lojas(id),
  empresa_id      uuid not null references empresas(id),  -- grupo (preenchido pela loja)
  numero          bigint not null,
  venda_item_id   uuid references venda_itens(id),
  servico_id      uuid not null references servicos(id),
  cliente_id      uuid not null references clientes(id),
  veiculo_id      uuid not null references veiculos(id),
  checklist_id    uuid references checklist_modelos(id),
  vistoriador_id  uuid references usuarios(id),
  status          status_vistoria not null default 'agendada',
  resultado       resultado_vistoria,
  agendada_para   timestamptz,
  iniciada_em     timestamptz,
  concluida_em    timestamptz,
  km              integer,
  parecer         text,
  laudo_path      text,                         -- PDF do laudo (storage)
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  unique (empresa_id, numero),
  check (status <> 'concluida' or resultado is not null)
);

create trigger trg_vistorias_numero before insert on vistorias
  for each row execute function numerar_por_grupo('vistoria');

create table vistoria_itens (
  id            uuid primary key default gen_random_uuid(),
  vistoria_id   uuid not null references vistorias(id) on delete cascade,
  modelo_item_id uuid references checklist_modelo_itens(id),
  grupo         text,
  descricao     text not null,
  situacao      situacao_item,
  observacao    text
);

create table vistoria_fotos (
  id             uuid primary key default gen_random_uuid(),
  vistoria_id    uuid not null references vistorias(id) on delete cascade,
  vistoria_item_id uuid references vistoria_itens(id) on delete set null,
  legenda        text,                          -- ex.: Frente, Traseira, Chassi
  storage_path   text not null,
  placa_lida_ocr text,
  tirada_em      timestamptz not null default now(),
  latitude       numeric(9,6),
  longitude      numeric(9,6)
);

-- =====================================================================
-- 7. Financeiro
-- =====================================================================
create table contas_financeiras (
  id             uuid primary key default gen_random_uuid(),
  loja_id        uuid not null references lojas(id),
  tipo           tipo_conta_fin not null,
  nome           text not null,                 -- ex.: Caixa Loja 1, Itaú CC
  banco_codigo   text,                          -- ex.: 341
  agencia        text,
  conta          text,
  saldo_inicial  numeric(14,2) not null default 0,
  data_saldo_inicial date not null default current_date,
  integracao     text,                          -- ex.: open_finance, api_banco, manual
  integracao_ref text,                          -- id externo da conta na integração
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);

-- Contas a pagar e a receber (cada parcela é um lançamento)
create table lancamentos (
  id              uuid primary key default gen_random_uuid(),
  loja_id         uuid not null references lojas(id),
  tipo            tipo_lancamento not null,
  categoria_id    uuid references categorias_financeiras(id),
  descricao       text not null,
  cliente_id      uuid references clientes(id),
  fornecedor_id   uuid references fornecedores(id),
  venda_id        uuid references vendas(id),
  apuracao_royalty_id uuid,                     -- FK adicionada na seção 9
  competencia     date not null default current_date,
  vencimento      date not null,
  valor           numeric(12,2) not null check (valor > 0),
  valor_pago      numeric(12,2) not null default 0,
  status          status_lancamento not null default 'em_aberto',
  forma_pagamento forma_pagamento,
  conta_id        uuid references contas_financeiras(id),
  pago_em         date,
  parcela         smallint not null default 1,
  total_parcelas  smallint not null default 1,
  grupo_parcelas  uuid,                         -- liga as parcelas de um mesmo lançamento
  documento       text,                         -- nº do boleto, NF etc.
  observacoes     text,
  criado_por      uuid references usuarios(id),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  check (tipo = 'receber' or fornecedor_id is not null or categoria_id is not null)
);
create index lancamentos_venc on lancamentos(loja_id, tipo, status, vencimento);

-- Baixas (pagamentos/recebimentos parciais ou totais)
create table lancamento_baixas (
  id             uuid primary key default gen_random_uuid(),
  lancamento_id  uuid not null references lancamentos(id) on delete cascade,
  data           date not null default current_date,
  valor          numeric(12,2) not null check (valor > 0),
  juros          numeric(12,2) not null default 0,
  multa          numeric(12,2) not null default 0,
  desconto       numeric(12,2) not null default 0,
  forma_pagamento forma_pagamento not null,
  conta_id       uuid not null references contas_financeiras(id),
  criado_por     uuid references usuarios(id),
  criado_em      timestamptz not null default now()
);

create or replace function lancamentos_atualizar_pago() returns trigger
language plpgsql as $$
declare l uuid := coalesce(new.lancamento_id, old.lancamento_id);
        total numeric(12,2);
        ultimo date;
begin
  select coalesce(sum(valor), 0), max(data) into total, ultimo
    from lancamento_baixas where lancamento_id = l;
  update lancamentos set
    valor_pago = total,
    pago_em    = case when total >= valor then ultimo end,
    status     = case when status = 'cancelado' then status
                      when total >= valor then 'pago'
                      when total > 0 then 'pago_parcial'
                      else 'em_aberto' end
  where id = l;
  return null;
end $$;
create trigger trg_baixas after insert or update or delete on lancamento_baixas
  for each row execute function lancamentos_atualizar_pago();

-- Painel "A receber / A pagar" da tela inicial
create or replace view resumo_contas with (security_invoker = true) as
select loja_id, tipo,
  sum(valor - valor_pago) filter (where vencimento <  current_date) as vencidos,
  sum(valor - valor_pago) filter (where vencimento =  current_date) as vencem_hoje,
  sum(valor - valor_pago) filter (where vencimento >  current_date
        and vencimento <= (date_trunc('month', current_date) + interval '1 month - 1 day')::date) as restante_mes
from lancamentos
where status in ('em_aberto', 'pago_parcial')
group by loja_id, tipo;

-- =====================================================================
-- 8. Maquininhas, cartão e bancos
-- =====================================================================
create table maquininhas (
  id             uuid primary key default gen_random_uuid(),
  loja_id        uuid not null references lojas(id),
  adquirente     text not null,                 -- ex.: Stone, Cielo, Rede, PagSeguro, Mercado Pago
  apelido        text,
  numero_serie   text,
  codigo_estabelecimento text,
  conta_id       uuid references contas_financeiras(id),  -- onde o dinheiro cai
  integracao_ref text,
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now()
);

-- Taxas por modalidade e número de parcelas
create table maquininha_taxas (
  id            uuid primary key default gen_random_uuid(),
  maquininha_id uuid not null references maquininhas(id) on delete cascade,
  modalidade    modalidade_cartao not null,
  bandeira      text,                           -- null = todas
  parcelas      smallint not null default 1,
  taxa_percent  numeric(6,3) not null,
  prazo_dias    smallint not null default 1
);

create table transacoes_cartao (
  id              uuid primary key default gen_random_uuid(),
  maquininha_id   uuid not null references maquininhas(id),
  venda_id        uuid references vendas(id),
  lancamento_id   uuid references lancamentos(id),   -- conta a receber gerada
  nsu             text,
  autorizacao     text,
  bandeira        text,
  modalidade      modalidade_cartao not null,
  parcelas        smallint not null default 1,
  valor_bruto     numeric(12,2) not null,
  taxa            numeric(12,2) not null default 0,
  valor_liquido   numeric(12,2) generated always as (valor_bruto - taxa) stored,
  data_transacao  timestamptz not null,
  previsao_recebimento date,
  status          status_transacao not null default 'aprovada',
  conciliada      boolean not null default false,
  dados_origem    jsonb,
  criado_em       timestamptz not null default now(),
  unique (maquininha_id, nsu, autorizacao)
);

-- Extrato importado do banco (OFX, API ou Open Finance) para conciliação
create table extrato_bancario (
  id             uuid primary key default gen_random_uuid(),
  conta_id       uuid not null references contas_financeiras(id),
  data           date not null,
  descricao      text not null,
  valor          numeric(14,2) not null,        -- positivo = entrada, negativo = saída
  id_externo     text,
  baixa_id       uuid references lancamento_baixas(id),
  conciliado     boolean not null default false,
  importado_em   timestamptz not null default now(),
  unique (conta_id, id_externo)
);

-- Arquivos baixados das administradoras de cartão e dos bancos (CSV, OFX,
-- EDI...). O sistema lê o arquivo e cria as transações e o extrato sozinho.
create table importacoes_arquivo (
  id             uuid primary key default gen_random_uuid(),
  loja_id        uuid not null references lojas(id),
  origem         text not null,                 -- ex.: stone, cielo, rede, pagseguro, itau, bradesco
  tipo           text not null check (tipo in ('vendas_cartao', 'recebiveis', 'extrato_bancario')),
  formato        text not null,                 -- ex.: csv, ofx, xlsx, edi
  nome_arquivo   text not null,
  storage_path   text,
  hash_arquivo   text,                          -- evita importar o mesmo arquivo duas vezes
  status         text not null default 'pendente' check (status in ('pendente', 'processando', 'concluida', 'erro')),
  linhas_lidas   integer not null default 0,
  linhas_criadas integer not null default 0,
  linhas_ignoradas integer not null default 0,
  erros          jsonb,
  importado_por  uuid references usuarios(id),
  criado_em      timestamptz not null default now(),
  unique (loja_id, hash_arquivo)
);

alter table transacoes_cartao add column importacao_id uuid references importacoes_arquivo(id);
alter table extrato_bancario  add column importacao_id uuid references importacoes_arquivo(id);

-- =====================================================================
-- 9. Royalties
-- =====================================================================
-- Regra por serviço cadastrado. Cada empresa (grupo) ou loja pode ter o seu
-- valor; vale sempre a regra mais específica:
--   serviço + loja > serviço + empresa > serviço (rede) > loja > empresa > rede
create table regras_royalty (
  id               uuid primary key default gen_random_uuid(),
  franquia_id      uuid not null references franquias(id),
  servico_id       uuid references servicos(id),       -- null = qualquer serviço
  empresa_id       uuid references empresas(id),       -- null = regra geral da rede
  loja_id          uuid references lojas(id),          -- regra específica de uma loja
  base             base_royalty not null default 'faturamento_bruto',
  percentual       numeric(6,3),                       -- ex.: 5.000 (%) sobre o faturamento do serviço
  valor_fixo       numeric(12,2),                      -- ex.: R$ 10,00 por serviço vendido
  valor_minimo     numeric(12,2) not null default 0,   -- mínimo do mês para este serviço
  fundo_propaganda_percent numeric(6,3) not null default 0,
  dia_vencimento   smallint not null default 10 check (dia_vencimento between 1 and 28),
  vigente_de       date not null,
  vigente_ate      date,
  check ((base = 'valor_fixo' and valor_fixo is not null) or (base <> 'valor_fixo' and percentual is not null))
);

-- Cálculo mensal por loja (total) ...
create table apuracoes_royalty (
  id                 uuid primary key default gen_random_uuid(),
  loja_id            uuid not null references lojas(id),
  competencia        date not null check (competencia = date_trunc('month', competencia)::date),
  faturamento_bruto  numeric(14,2) not null default 0,
  faturamento_liquido numeric(14,2) not null default 0,
  qtd_servicos       numeric(12,2) not null default 0,
  valor_royalty      numeric(12,2) not null default 0,
  valor_fundo        numeric(12,2) not null default 0,
  valor_total        numeric(12,2) generated always as (valor_royalty + valor_fundo) stored,
  status             status_apuracao not null default 'rascunho',
  fechada_por        uuid references usuarios(id),
  fechada_em         timestamptz,
  criado_em          timestamptz not null default now(),
  unique (loja_id, competencia)
);

-- ... e o detalhe por serviço, com a regra usada em cada um
create table apuracao_royalty_itens (
  id                 uuid primary key default gen_random_uuid(),
  apuracao_id        uuid not null references apuracoes_royalty(id) on delete cascade,
  servico_id         uuid not null references servicos(id),
  regra_id           uuid references regras_royalty(id),
  quantidade         numeric(12,2) not null default 0,
  faturamento_bruto  numeric(14,2) not null default 0,
  faturamento_liquido numeric(14,2) not null default 0,
  valor_royalty      numeric(12,2) not null default 0,
  valor_fundo        numeric(12,2) not null default 0,
  unique (apuracao_id, servico_id)
);

alter table lancamentos
  add constraint lancamentos_apuracao_fk foreign key (apuracao_royalty_id) references apuracoes_royalty(id);

-- Regra vigente para um serviço numa loja
create or replace function regra_royalty_vigente(p_loja uuid, p_servico uuid, p_data date)
returns regras_royalty
language sql stable as $$
  select r.* from regras_royalty r join lojas l on l.id = p_loja
   where (r.servico_id = p_servico or r.servico_id is null)
     and (r.loja_id = p_loja or (r.loja_id is null and (r.empresa_id = l.empresa_id or r.empresa_id is null)))
     and r.vigente_de <= p_data and (r.vigente_ate is null or r.vigente_ate >= p_data)
   order by (r.servico_id is not null) desc, (r.loja_id is not null) desc,
            (r.empresa_id is not null) desc, r.vigente_de desc
   limit 1
$$;

-- Calcula (ou recalcula) a apuração de uma loja num mês, serviço por serviço,
-- a partir das vendas aprovadas. Apuração já fechada não é recalculada.
create or replace function calcular_royalty(p_loja uuid, p_competencia date) returns uuid
language plpgsql as $$
declare
  ini date := date_trunc('month', p_competencia)::date;
  fim date := (date_trunc('month', p_competencia) + interval '1 month')::date;
  ap  uuid;
  st  status_apuracao;
  taxas numeric(14,2);
  bruto_loja numeric(14,2);
  s   record;
  r   regras_royalty;
  liq numeric(14,2);
  roy numeric(12,2);
begin
  select id, status into ap, st from apuracoes_royalty where loja_id = p_loja and competencia = ini;
  if st is not null and st <> 'rascunho' then
    return ap;
  end if;
  if ap is null then
    insert into apuracoes_royalty (loja_id, competencia) values (p_loja, ini) returning id into ap;
  end if;
  delete from apuracao_royalty_itens where apuracao_id = ap;

  -- taxas de cartão do mês, para a base "faturamento líquido" (rateadas pelo faturamento)
  select coalesce(sum(t.taxa), 0) into taxas
    from transacoes_cartao t join vendas v on v.id = t.venda_id
   where v.loja_id = p_loja and v.situacao = 'aprovado' and v.tipo = 'venda_avulsa'
     and v.data_venda >= ini and v.data_venda < fim and t.status = 'aprovada';

  select coalesce(sum(i.valor_total), 0) into bruto_loja
    from venda_itens i join vendas v on v.id = i.venda_id
   where v.loja_id = p_loja and v.situacao = 'aprovado' and v.tipo = 'venda_avulsa'
     and v.data_venda >= ini and v.data_venda < fim;

  for s in
    select i.servico_id, sum(i.quantidade) as qtd, sum(i.valor_total) as bruto
      from venda_itens i join vendas v on v.id = i.venda_id
     where v.loja_id = p_loja and v.situacao = 'aprovado' and v.tipo = 'venda_avulsa'
       and v.data_venda >= ini and v.data_venda < fim
     group by i.servico_id
  loop
    r := regra_royalty_vigente(p_loja, s.servico_id, ini);
    liq := s.bruto - case when bruto_loja > 0 then round(taxas * s.bruto / bruto_loja, 2) else 0 end;
    if r.id is null then
      roy := 0;
    else
      roy := case r.base
               when 'valor_fixo'          then s.qtd * r.valor_fixo
               when 'faturamento_liquido' then round(liq * r.percentual / 100, 2)
               else                            round(s.bruto * r.percentual / 100, 2)
             end;
      roy := greatest(roy, r.valor_minimo);
    end if;
    insert into apuracao_royalty_itens (apuracao_id, servico_id, regra_id, quantidade,
                                        faturamento_bruto, faturamento_liquido, valor_royalty, valor_fundo)
    values (ap, s.servico_id, r.id, s.qtd, s.bruto, liq, roy,
            coalesce(round(s.bruto * r.fundo_propaganda_percent / 100, 2), 0));
  end loop;

  update apuracoes_royalty a set
    faturamento_bruto   = coalesce(x.bruto, 0),
    faturamento_liquido = coalesce(x.liq, 0),
    qtd_servicos        = coalesce(x.qtd, 0),
    valor_royalty       = coalesce(x.roy, 0),
    valor_fundo         = coalesce(x.fundo, 0)
  from (select sum(faturamento_bruto) bruto, sum(faturamento_liquido) liq, sum(quantidade) qtd,
               sum(valor_royalty) roy, sum(valor_fundo) fundo
          from apuracao_royalty_itens where apuracao_id = ap) x
  where a.id = ap;

  return ap;
end $$;

-- =====================================================================
-- 10. Controle de ponto
-- =====================================================================
create table jornadas (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios(id) on delete cascade,
  dia_semana    smallint not null check (dia_semana between 0 and 6),  -- 0 = domingo
  entrada       time not null,
  saida         time not null,
  intervalo_min smallint not null default 60,
  unique (usuario_id, dia_semana)
);

create table marcacoes_ponto (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references usuarios(id),
  loja_id      uuid not null references lojas(id),
  tipo         tipo_marcacao_ponto not null,
  registrado_em timestamptz not null default now(),
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  foto_path    text,                            -- selfie no app
  origem       text not null default 'app',     -- app, web, ajuste
  -- ajustes manuais nunca apagam a marcação original
  ajuste_de    uuid references marcacoes_ponto(id),
  ajustado_por uuid references usuarios(id),
  motivo_ajuste text,
  criado_em    timestamptz not null default now(),
  check (origem <> 'ajuste' or (ajustado_por is not null and motivo_ajuste is not null))
);
create index marcacoes_ponto_dia on marcacoes_ponto(usuario_id, registrado_em);

-- =====================================================================
-- 11. WhatsApp e auditoria
-- =====================================================================
create table whatsapp_mensagens (
  id          uuid primary key default gen_random_uuid(),
  loja_id     uuid not null references lojas(id),
  cliente_id  uuid references clientes(id),
  vistoria_id uuid references vistorias(id),
  venda_id    uuid references vendas(id),
  telefone    text not null,
  modelo      text,                             -- ex.: laudo_pronto, orcamento
  texto       text not null,
  link        text,                             -- wa.me/... gerado
  enviado_por uuid references usuarios(id),
  criado_em   timestamptz not null default now()
);

create table auditoria (
  id          bigserial primary key,
  usuario_id  uuid,
  tabela      text not null,
  registro_id uuid,
  acao        text not null,                    -- insert, update, delete
  antes       jsonb,
  depois      jsonb,
  criado_em   timestamptz not null default now()
);

create or replace function auditar() returns trigger
language plpgsql security definer as $$
begin
  insert into auditoria (usuario_id, tabela, registro_id, acao, antes, depois)
  values (app_usuario_atual(), tg_table_name,
          coalesce((case when tg_op = 'DELETE' then old.id else new.id end), null),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

create trigger aud_vendas      after insert or update or delete on vendas            for each row execute function auditar();
create trigger aud_lancamentos after insert or update or delete on lancamentos       for each row execute function auditar();
create trigger aud_baixas      after insert or update or delete on lancamento_baixas for each row execute function auditar();
create trigger aud_vistorias   after insert or update or delete on vistorias         for each row execute function auditar();
create trigger aud_ponto       after insert or update or delete on marcacoes_ponto   for each row execute function auditar();
create trigger aud_royalty     after insert or update or delete on apuracoes_royalty for each row execute function auditar();

-- atualizado_em automático
create trigger upd_franquias  before update on franquias  for each row execute function set_atualizado_em();
create trigger upd_empresas   before update on empresas   for each row execute function set_atualizado_em();
create trigger upd_lojas      before update on lojas      for each row execute function set_atualizado_em();
create trigger upd_usuarios   before update on usuarios   for each row execute function set_atualizado_em();
create trigger upd_clientes   before update on clientes   for each row execute function set_atualizado_em();
create trigger upd_veiculos   before update on veiculos   for each row execute function set_atualizado_em();
create trigger upd_vendas     before update on vendas     for each row execute function set_atualizado_em();
create trigger upd_vistorias  before update on vistorias  for each row execute function set_atualizado_em();
create trigger upd_lancamentos before update on lancamentos for each row execute function set_atualizado_em();

-- =====================================================================
-- 12. Segurança (Row Level Security)
-- =====================================================================
create or replace function eh_admin_rede() returns boolean
language sql stable security definer as $$
  select coalesce((select admin_rede from usuarios where id = app_usuario_atual()), false)
$$;

create or replace function tem_loja(p_loja uuid) returns boolean
language sql stable security definer as $$
  select eh_admin_rede() or exists (
    select 1 from usuario_lojas where usuario_id = app_usuario_atual() and loja_id = p_loja and ativo)
$$;

create or replace function tem_empresa(p_empresa uuid) returns boolean
language sql stable security definer as $$
  select eh_admin_rede() or exists (
    select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
     where ul.usuario_id = app_usuario_atual() and ul.ativo and l.empresa_id = p_empresa)
$$;

-- O usuário tem a permissão X na loja Y?
create or replace function pode(p_loja uuid, p_permissao text) returns boolean
language sql stable security definer as $$
  select eh_admin_rede() or exists (
    select 1 from usuario_lojas ul
      join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
     where ul.usuario_id = app_usuario_atual() and ul.loja_id = p_loja and ul.ativo
       and pp.permissao = p_permissao)
$$;

do $$
declare t text;
begin
  -- tabelas com loja_id: acesso pela loja
  foreach t in array array['vendas','vistorias','contas_financeiras','lancamentos','maquininhas',
                           'consultas_placa','marcacoes_ponto','whatsapp_mensagens','apuracoes_royalty','importacoes_arquivo']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (tem_loja(loja_id)) with check (tem_loja(loja_id))',
                   t || '_por_loja', t);
  end loop;

  -- tabelas com empresa_id: acesso pela empresa
  foreach t in array array['contadores','clientes','fornecedores','servicos','perfis','categorias_financeiras','checklist_modelos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id))',
                   t || '_por_empresa', t);
  end loop;
end $$;

alter table lojas enable row level security;
create policy lojas_acesso on lojas for select using (tem_loja(id));
create policy lojas_admin  on lojas for all    using (eh_admin_rede()) with check (eh_admin_rede());

alter table empresas enable row level security;
create policy empresas_acesso on empresas for select using (tem_empresa(id));
create policy empresas_admin  on empresas for all    using (eh_admin_rede()) with check (eh_admin_rede());

alter table usuarios enable row level security;
create policy usuarios_proprio on usuarios for select using (id = app_usuario_atual() or eh_admin_rede()
  or exists (select 1 from usuario_lojas a join usuario_lojas b on a.loja_id = b.loja_id
              where a.usuario_id = app_usuario_atual() and b.usuario_id = usuarios.id));
create policy usuarios_admin on usuarios for all using (eh_admin_rede()) with check (eh_admin_rede());

alter table apuracao_royalty_itens enable row level security;
create policy apuracao_itens_por_loja on apuracao_royalty_itens for all
  using (exists (select 1 from apuracoes_royalty a where a.id = apuracao_id and tem_loja(a.loja_id)))
  with check (exists (select 1 from apuracoes_royalty a where a.id = apuracao_id and tem_loja(a.loja_id)));

-- Ações sensíveis exigem permissão específica além do acesso à loja
create policy lancamentos_excluir on lancamentos as restrictive for delete
  using (pode(loja_id, 'financeiro.excluir'));
create policy apuracao_fechar on apuracoes_royalty as restrictive for update
  using (pode(loja_id, 'royalties.fechar') or status = 'rascunho');
create policy ponto_ajuste on marcacoes_ponto as restrictive for insert
  with check (origem <> 'ajuste' or pode(loja_id, 'ponto.ajustar'));

-- =====================================================================
-- Dados iniciais: catálogo de permissões
-- =====================================================================
-- A permissão terminada em ".ver" (ou a primeira de cada módulo) libera o
-- módulo no menu e nos atalhos. O usuário master (admin_rede) vê tudo.
insert into permissoes (codigo, modulo, descricao) values
  ('vistorias.ver',        'Vistorias',            'Ver o módulo de vistorias'),
  ('vistorias.criar',      'Vistorias',            'Abrir e executar vistorias'),
  ('vistorias.concluir',   'Vistorias',            'Concluir e emitir laudo'),
  ('vistorias.cancelar',   'Vistorias',            'Cancelar vistorias'),
  ('placa.consultar',      'Consulta de placa',    'Consultar placa (API Placas)'),
  ('placa.foto',           'Ler placa por foto',   'Ler a placa pela câmera'),
  ('clientes.ver',         'Clientes',             'Ver o módulo de clientes'),
  ('clientes.editar',      'Clientes',             'Cadastrar e editar clientes'),
  ('clientes.serasa',      'Clientes',             'Consultar cliente no Serasa'),
  ('vendas.ver',           'Vendas',               'Ver vendas e orçamentos'),
  ('vendas.criar',         'Vendas',               'Criar vendas e orçamentos'),
  ('vendas.cancelar',      'Vendas',               'Cancelar vendas'),
  ('vendas.desconto',      'Vendas',               'Dar desconto'),
  ('financeiro.ver',       'Financeiro',           'Ver contas a pagar e receber'),
  ('financeiro.lancar',    'Financeiro',           'Criar lançamentos e dar baixa'),
  ('financeiro.excluir',   'Financeiro',           'Excluir lançamentos'),
  ('financeiro.conciliar', 'Financeiro',           'Conciliar banco e maquininhas'),
  ('financeiro.importar',  'Financeiro',           'Importar arquivos de administradoras e bancos'),
  ('royalties.ver',        'Royalties',            'Ver apurações de royalties'),
  ('royalties.fechar',     'Royalties',            'Fechar apuração de royalties'),
  ('royalties.configurar', 'Royalties',            'Configurar regras de royalties por serviço'),
  ('maquininhas.ver',      'Maquininhas e bancos', 'Ver maquininhas, contas e extratos'),
  ('integracoes.gerenciar','Maquininhas e bancos', 'Configurar bancos e maquininhas'),
  ('lojas.gerenciar',      'Lojas',                'Gerenciar lojas'),
  ('usuarios.gerenciar',   'Usuários e permissões','Gerenciar usuários e perfis'),
  ('ponto.registrar',      'Controle de ponto',    'Registrar o próprio ponto'),
  ('ponto.ver_equipe',     'Controle de ponto',    'Ver o ponto da equipe'),
  ('ponto.ajustar',        'Controle de ponto',    'Ajustar marcações de ponto'),
  ('relatorios.ver',       'Relatórios',           'Ver relatórios'),
  ('relatorios.exportar',  'Relatórios',           'Exportar relatórios'),
  ('whatsapp.enviar',      'WhatsApp',             'Enviar mensagens pelo WhatsApp'),
  ('config.gerenciar',     'Configurações',        'Alterar as configurações do sistema');
