-- Confirmação do agendamento pelo WhatsApp: o cliente responde SIM (fica Confirmado) ou NÃO
-- (o robô pergunta o dia e depois a hora e remarca). Toda remarcação fica no histórico, que a
-- agenda mostra no dia de onde o agendamento saiu.

alter table agendamentos add column if not exists confirmacao_etapa text;   -- aguardando | dia | hora (null = nada pendente)
alter table agendamentos add column if not exists confirmacao_dados jsonb;
do $$ begin
  alter table agendamentos add constraint agendamentos_confirmacao_etapa check (confirmacao_etapa in ('aguardando', 'dia', 'hora'));
exception when duplicate_object then null; end $$;

create table if not exists agenda_historico (
  id             uuid primary key default gen_random_uuid(),
  agendamento_id uuid not null references agendamentos(id) on delete cascade,
  empresa_id     uuid not null references empresas(id),
  loja_id        uuid not null references lojas(id),
  acao           text not null check (acao in ('confirmado', 'nao_confirmado', 'remarcado')),
  de_inicio      timestamptz,             -- horário antes da mudança (o dia em que o registro aparece)
  para_inicio    timestamptz,
  origem         text not null default 'whatsapp' check (origem in ('whatsapp', 'manual')),
  usuario_id     uuid references usuarios(id),
  criado_em      timestamptz not null default now()
);
create index if not exists agenda_historico_loja_de on agenda_historico(loja_id, de_inicio);
create index if not exists agenda_historico_agendamento on agenda_historico(agendamento_id, criado_em);

-- DDD + 8 últimos dígitos: o mesmo celular com ou sem 55 e com ou sem o 9
create or replace function tel_chave(p text) returns text language sql immutable as $$
  select case when length(d) >= 12 then substr(d, 3, 2) else left(d, 2) end || right(d, 8)
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
   where length(d) >= 10
$$;

-- Confirmação pendente do contato (a última mandada), com o que o robô precisa para responder
create or replace function app_agenda_confirmacao_pendente(p_contato uuid) returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
           'ag', to_jsonb(a), 'loja', to_jsonb(l), 'telefone', k.telefone, 'phone_number_id', n.phone_number_id,
           'chamado_id', (select h.id from whatsapp_chamados h where h.contato_id = k.id and h.aberto order by h.criado_em desc limit 1),
           'ultima', (select m.texto from whatsapp_conversa m where m.contato_id = k.id and m.direcao = 'entrada' order by m.criado_em desc limit 1))
    from whatsapp_contatos k
    join agendamentos a on a.empresa_id = k.empresa_id and a.confirmacao_etapa is not null
                       and a.situacao in ('agendado', 'confirmado') and a.inicio > now() - interval '12 hours'
                       and tel_chave(a.telefone) = tel_chave(k.telefone)
    join lojas l on l.id = a.loja_id
    left join whatsapp_numeros n on n.empresa_id = k.empresa_id and n.ativo
   where k.id = p_contato
   order by a.confirmacao_em desc nulls last
   limit 1
$$;

-- Guarda em que pergunta a conversa está
create or replace function app_agenda_confirmacao_passo(p_ag uuid, p_etapa text, p_dados jsonb) returns void
language sql security definer as $$
  update agendamentos set confirmacao_etapa = p_etapa, confirmacao_dados = p_dados, atualizado_em = now() where id = p_ag;
$$;

-- Cliente respondeu SIM (ou NÃO, que fica registrado antes de remarcar)
create or replace function app_agenda_resposta_cliente(p_ag uuid, p_sim boolean) returns void
language plpgsql security definer as $$
declare a agendamentos;
begin
  select * into a from agendamentos where id = p_ag;
  if a.id is null then return; end if;
  insert into agenda_historico (agendamento_id, empresa_id, loja_id, acao, de_inicio)
  values (a.id, a.empresa_id, a.loja_id, case when p_sim then 'confirmado' else 'nao_confirmado' end, a.inicio);
  if p_sim then
    update agendamentos set situacao = 'confirmado', confirmacao_etapa = null, confirmacao_dados = null, atualizado_em = now() where id = a.id;
  else
    update agendamentos set situacao = 'agendado', atualizado_em = now() where id = a.id;   -- até escolher o novo horário
  end if;
end $$;

-- Remarca no horário que o cliente escolheu, se ainda estiver livre. Devolve false se alguém pegou antes.
create or replace function app_agenda_remarcar_cliente(p_ag uuid, p_inicio timestamptz) returns boolean
language plpgsql security definer as $$
declare a agendamentos;
        c agenda_config;
        dia date := (p_inicio at time zone 'America/Sao_Paulo')::date;
begin
  select * into a from agendamentos where id = p_ag;
  if a.id is null then return false; end if;
  perform pg_advisory_xact_lock(hashtext('agenda:' || a.loja_id));
  if p_inicio <> a.inicio and not exists (select 1 from agenda_livres(a.loja_id, dia, dia) f where f.inicio = p_inicio) then
    return false;
  end if;
  select * into c from agenda_config where loja_id = a.loja_id;
  insert into agenda_historico (agendamento_id, empresa_id, loja_id, acao, de_inicio, para_inicio)
  values (a.id, a.empresa_id, a.loja_id, 'remarcado', a.inicio, p_inicio);
  update agendamentos
     set inicio = p_inicio, fim = p_inicio + make_interval(mins => coalesce(c.duracao_min, 30)), situacao = 'confirmado',
         confirmacao_etapa = null, confirmacao_dados = null, atualizado_em = now()
   where id = a.id;
  return true;
end $$;

-- Registra no chamado a mensagem que o robô mandou sobre a confirmação (o chamado pode não existir)
create or replace function app_agenda_registrar_conversa(p_contato uuid, p_chamado uuid, p_texto text, p_status text, p_erro text, p_id_externo text)
returns void language sql security definer as $$
  insert into whatsapp_conversa (empresa_id, contato_id, chamado_id, direcao, texto, status, erro, id_externo, robo)
  select k.empresa_id, k.id, p_chamado, 'saida', p_texto, p_status, p_erro, p_id_externo, true from whatsapp_contatos k where k.id = p_contato;
  update whatsapp_contatos set ultima_em = now() where id = p_contato;
$$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'agenda_historico') then
    alter table agenda_historico enable row level security;
    create policy agenda_historico_loja on agenda_historico for all using (tem_loja(loja_id)) with check (tem_loja(loja_id));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert on agenda_historico to app_api;
    grant execute on function tel_chave(text), app_agenda_confirmacao_pendente(uuid), app_agenda_confirmacao_passo(uuid, text, jsonb),
      app_agenda_resposta_cliente(uuid, boolean), app_agenda_remarcar_cliente(uuid, timestamptz),
      app_agenda_registrar_conversa(uuid, uuid, text, text, text, text) to app_api;
  end if;
end $$;
