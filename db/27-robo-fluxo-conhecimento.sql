-- =====================================================================
-- Robô do WhatsApp: fluxo de atendimento em blocos (mensagem, menu com caminhos, pergunta,
-- conversa com IA, abrir venda, passar para atendente, encerrar) e a base de conhecimento da IA
-- (textos e arquivos PDF/TXT que a IA consulta para responder).
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- [{id, tipo, nome, texto, campo, obrigatorio, opcoes: [{rotulo, ir}], campos: [{campo, obrigatorio}], ir}]
-- vazio = o fluxo antigo (as perguntas em "etapas")
alter table whatsapp_robo add column if not exists fluxo jsonb;

create table if not exists whatsapp_conhecimento (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id),
  titulo        text not null,
  tipo          text not null check (tipo in ('texto', 'pdf')),
  conteudo      text,                   -- texto digitado ou o texto de um .txt
  arquivo       bytea,                  -- PDF
  nome_arquivo  text,
  tamanho       integer not null default 0,
  ativo         boolean not null default true,
  criado_por    uuid references usuarios(id),
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists whatsapp_conhecimento_grupo on whatsapp_conhecimento(empresa_id);

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'whatsapp_conhecimento') then
    alter table whatsapp_conhecimento enable row level security;
    create policy whatsapp_conhecimento_grupo on whatsapp_conhecimento for all
      using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on whatsapp_conhecimento to app_api;
  end if;
end $$;

-- O robô roda sem usuário logado: a base de conhecimento ativa do grupo (PDF em base64)
create or replace function app_robo_conhecimento(p_empresa uuid)
returns table (id uuid, titulo text, tipo text, conteudo text, pdf text)
language sql stable security definer as $$
  select k.id, k.titulo, k.tipo, k.conteudo, case when k.tipo = 'pdf' then encode(k.arquivo, 'base64') end
    from whatsapp_conhecimento k
   where k.empresa_id = p_empresa and k.ativo
   order by k.criado_em
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_robo_conhecimento(uuid) to app_api;
  end if;
end $$;
