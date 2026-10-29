-- Agenda de vistorias: horários de atendimento de cada loja, bloqueios (feriado, folga) e
-- os agendamentos. O robô do WhatsApp oferece os horários livres e agenda sozinho.

do $$ begin
  create type situacao_agenda as enum ('agendado', 'confirmado', 'compareceu', 'faltou', 'cancelado');
exception when duplicate_object then null; end $$;

-- Horário de atendimento da loja. horarios: {"1": {"abre": "08:00", "fecha": "17:00"}, ...}
-- com a chave = dia da semana (0 = domingo ... 6 = sábado); dia sem chave = fechado.
create table if not exists agenda_config (
  loja_id          uuid primary key references lojas(id),
  ativo            boolean not null default true,
  horarios         jsonb not null default '{"1":{"abre":"08:00","fecha":"17:00"},"2":{"abre":"08:00","fecha":"17:00"},"3":{"abre":"08:00","fecha":"17:00"},"4":{"abre":"08:00","fecha":"17:00"},"5":{"abre":"08:00","fecha":"17:00"},"6":{"abre":"08:00","fecha":"12:00"}}',
  almoco_inicio    time default '12:00',
  almoco_fim       time default '13:00',
  duracao_min      integer not null default 30 check (duracao_min between 5 and 480),
  vagas            integer not null default 1 check (vagas between 1 and 50),   -- vistorias ao mesmo tempo
  antecedencia_min integer not null default 60 check (antecedencia_min >= 0),   -- não agenda em cima da hora
  dias_a_frente    integer not null default 30 check (dias_a_frente between 1 and 365),
  atualizado_em    timestamptz not null default now()
);

create table if not exists agenda_bloqueios (
  id         uuid primary key default gen_random_uuid(),
  loja_id    uuid not null references lojas(id),
  inicio     timestamptz not null,
  fim        timestamptz not null check (fim > inicio),
  motivo     text,
  criado_por uuid references usuarios(id),
  criado_em  timestamptz not null default now()
);
create index if not exists agenda_bloqueios_loja on agenda_bloqueios(loja_id, inicio);

create table if not exists agendamentos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id),
  loja_id        uuid not null references lojas(id),
  inicio         timestamptz not null,
  fim            timestamptz not null check (fim > inicio),
  situacao       situacao_agenda not null default 'agendado',
  origem         text not null default 'manual' check (origem in ('manual', 'whatsapp')),
  nome           text not null,
  telefone       text,
  placa          text,
  servico_id     uuid references servicos(id),
  cliente_id     uuid references clientes(id),
  venda_id       uuid references vendas(id) on delete set null,
  chamado_id     uuid references whatsapp_chamados(id) on delete set null,
  observacao     text,
  confirmacao_em timestamptz,          -- quando a confirmação foi mandada pelo WhatsApp
  criado_por     uuid references usuarios(id),
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists agendamentos_loja_inicio on agendamentos(loja_id, inicio);

-- Permissões
insert into permissoes (codigo, modulo, descricao, nivel) values
  ('agenda.ver',       'Agenda', 'Ver a agenda', 'consulta'),
  ('agenda.gerenciar', 'Agenda', 'Agendar, remarcar e configurar os horários', 'uso')
on conflict (codigo) do nothing;
-- quem vê vendas vê a agenda; quem cria vendas agenda
insert into perfil_permissoes (perfil_id, permissao)
select pp.perfil_id, n.nova
  from perfil_permissoes pp
  join (values ('vendas.ver', 'agenda.ver'), ('vendas.criar', 'agenda.gerenciar'), ('vendas.criar', 'agenda.ver')) n(tem, nova) on n.tem = pp.permissao
on conflict do nothing;

-- Horários livres da loja entre duas datas (com quantas vagas sobram em cada um).
-- p_antecedencia: respeita a antecedência mínima (robô e cliente); a equipe na agenda pode usar
-- qualquer horário que ainda não passou.
create or replace function agenda_livres_base(p_loja uuid, p_de date, p_ate date, p_antecedencia boolean)
returns table (inicio timestamptz, fim timestamptz, vagas integer)
language plpgsql security definer as $$
declare c agenda_config;
        d date;
        h jsonb;
        t timestamp;
        ts timestamptz;
        dur interval;
        usadas integer;
        limite date;
begin
  select * into c from agenda_config where loja_id = p_loja;
  if c.loja_id is null then
    insert into agenda_config (loja_id) values (p_loja) on conflict do nothing;
    select * into c from agenda_config where loja_id = p_loja;
  end if;
  if not c.ativo then return; end if;
  dur := make_interval(mins => c.duracao_min);
  limite := least(p_ate, (now() at time zone 'America/Sao_Paulo')::date + c.dias_a_frente);
  d := greatest(p_de, (now() at time zone 'America/Sao_Paulo')::date);
  while d <= limite loop
    h := c.horarios -> extract(dow from d)::int::text;
    if h is not null and h ? 'abre' and h ? 'fecha' then
      t := d + (h->>'abre')::time;
      while t + dur <= d + (h->>'fecha')::time loop
        ts := t at time zone 'America/Sao_Paulo';
        if ts >= now() + make_interval(mins => case when p_antecedencia then c.antecedencia_min else 0 end)
           and not (c.almoco_inicio is not null and c.almoco_fim is not null
                    and t::time < c.almoco_fim and (t + dur)::time > c.almoco_inicio)
           and not exists (select 1 from agenda_bloqueios b where b.loja_id = p_loja and b.inicio < ts + dur and b.fim > ts) then
          select count(*) into usadas from agendamentos a
           where a.loja_id = p_loja and a.situacao <> 'cancelado' and a.inicio < ts + dur and a.fim > ts;
          if usadas < c.vagas then
            inicio := ts; fim := ts + dur; vagas := c.vagas - usadas;
            return next;
          end if;
        end if;
        t := t + dur;
      end loop;
    end if;
    d := d + 1;
  end loop;
end $$;

create or replace function agenda_livres(p_loja uuid, p_de date, p_ate date)
returns table (inicio timestamptz, fim timestamptz, vagas integer)
language sql security definer as $$ select * from agenda_livres_base(p_loja, p_de, p_ate, true) $$;

create or replace function agenda_livres_equipe(p_loja uuid, p_de date, p_ate date)
returns table (inicio timestamptz, fim timestamptz, vagas integer)
language sql security definer as $$ select * from agenda_livres_base(p_loja, p_de, p_ate, false) $$;

-- Agenda pelo robô do WhatsApp (sem usuário logado). Confere de novo se o horário está livre.
-- p_dados: nome, telefone, placa, servico_id, observacao
create or replace function app_agenda_robo(p_chamado uuid, p_inicio timestamptz, p_dados jsonb) returns uuid
language plpgsql security definer as $$
declare v_ch whatsapp_chamados;
        v_r whatsapp_robo;
        v_loja uuid;
        v_fim timestamptz;
        v_id uuid;
begin
  select * into v_ch from whatsapp_chamados where id = p_chamado;
  if v_ch.id is null then return null; end if;
  select * into v_r from whatsapp_robo where empresa_id = v_ch.empresa_id;
  v_loja := coalesce(
    (select l.id from vendas v join lojas l on l.id = v.loja_id where v.id = v_ch.venda_id),
    -- unidade que o cliente escolheu na conversa
    (select l.id from lojas l where l.id::text = p_dados->>'loja_id' and l.ativo and l.empresa_id = v_ch.empresa_id),
    (select l.id from lojas l where l.id = v_r.loja_id and l.ativo and l.empresa_id = v_ch.empresa_id),
    (select l.id from lojas l where l.empresa_id = v_ch.empresa_id and l.ativo order by l.nome limit 1));
  perform pg_advisory_xact_lock(hashtext('agenda:' || v_loja));
  select f.fim into v_fim from agenda_livres(v_loja, (p_inicio at time zone 'America/Sao_Paulo')::date,
                                              (p_inicio at time zone 'America/Sao_Paulo')::date) f where f.inicio = p_inicio;
  if v_fim is null then return null; end if;  -- alguém pegou o horário antes
  insert into agendamentos (empresa_id, loja_id, inicio, fim, origem, nome, telefone, placa, servico_id, cliente_id, venda_id, chamado_id, observacao)
  values (v_ch.empresa_id, v_loja, p_inicio, v_fim, 'whatsapp',
          coalesce(nullif(upper(trim(p_dados->>'nome')), ''), (select nome from whatsapp_contatos where id = v_ch.contato_id), 'CLIENTE WHATSAPP'),
          coalesce(nullif(p_dados->>'telefone', ''), (select telefone from whatsapp_contatos where id = v_ch.contato_id)),
          nullif(p_dados->>'placa', ''),
          (select s.id from servicos s where s.id = nullif(p_dados->>'servico_id', '')::uuid and s.empresa_id = v_ch.empresa_id),
          (select cliente_id from whatsapp_contatos where id = v_ch.contato_id),
          v_ch.venda_id, v_ch.id, nullif(p_dados->>'observacao', ''))
  returning id into v_id;
  if v_ch.venda_id is not null then
    update vendas set data_venda = (p_inicio at time zone 'America/Sao_Paulo')::date where id = v_ch.venda_id and situacao = 'futuro';
  end if;
  return v_id;
end $$;

-- Horários livres para o robô (a loja em que o robô abre as vendas)
create or replace function app_agenda_livres_robo(p_empresa uuid, p_de date, p_limite integer)
returns table (inicio timestamptz, fim timestamptz)
language sql security definer as $$
  select f.inicio, f.fim
    from agenda_livres(coalesce(
           (select l.id from whatsapp_robo r join lojas l on l.id = r.loja_id and l.ativo where r.empresa_id = p_empresa),
           (select l.id from lojas l where l.empresa_id = p_empresa and l.ativo order by l.nome limit 1)),
         p_de, p_de + 60) f
   order by f.inicio
   limit p_limite
$$;

-- Loja do robô (nome e endereço, para a mensagem de confirmação)
create or replace function app_agenda_loja_robo(p_empresa uuid) returns jsonb
language sql stable security definer as $$
  select to_jsonb(x) from (
    select l.id, l.nome, l.logradouro, l.numero, l.bairro, l.cidade, l.uf
      from lojas l
     where l.id = coalesce((select r.loja_id from whatsapp_robo r join lojas k on k.id = r.loja_id and k.ativo where r.empresa_id = p_empresa),
                           (select k.id from lojas k where k.empresa_id = p_empresa and k.ativo order by k.nome limit 1))) x
$$;

-- Robôs já configurados: a pergunta "Data desejada" vira a escolha do horário na agenda
update whatsapp_robo r
   set etapas = (select jsonb_agg(case when e->>'campo' = 'data'
                                       then jsonb_build_object('campo', 'horario', 'pergunta', 'Escolha o melhor horário para a vistoria:', 'obrigatorio', true)
                                       else e end order by n)
                   from jsonb_array_elements(r.etapas) with ordinality as x(e, n)),
       atualizado_em = now()
 where exists (select 1 from jsonb_array_elements(r.etapas) e where e->>'campo' = 'data')
   and not exists (select 1 from jsonb_array_elements(r.etapas) e where e->>'campo' = 'horario');

-- Quando o robô abre a venda do chamado, o agendamento feito na conversa ganha a venda
-- e os dados finais (nome, placa e serviço podem ter vindo depois do horário)
create or replace function chamado_liga_agendamento() returns trigger
language plpgsql security definer as $$
begin
  if new.venda_id is not null and old.venda_id is null then
    update agendamentos a
       set venda_id = new.venda_id,
           nome = coalesce(nullif(upper(trim(new.robo_dados->>'nome')), ''), a.nome),
           placa = coalesce(nullif(new.robo_dados->>'placa', ''), a.placa),
           servico_id = coalesce((select s.id from servicos s where s.id::text = new.robo_dados->>'servico_id'), a.servico_id),
           -- só liga a um cliente cadastrado (com CPF/CNPJ), nunca ao particular/avulso
           cliente_id = coalesce((select v.cliente_id from vendas v join clientes c on c.id = v.cliente_id
                                   where v.id = new.venda_id and c.cpf_cnpj is not null), a.cliente_id),
           atualizado_em = now()
     where a.chamado_id = new.id and a.venda_id is null and a.situacao <> 'cancelado';
  end if;
  return null;
end $$;
drop trigger if exists trg_chamado_liga_agendamento on whatsapp_chamados;
create trigger trg_chamado_liga_agendamento after update of venda_id on whatsapp_chamados
  for each row execute function chamado_liga_agendamento();

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'agendamentos') then
    alter table agenda_config enable row level security;
    create policy agenda_config_loja on agenda_config for all using (tem_loja(loja_id)) with check (tem_loja(loja_id));
    alter table agenda_bloqueios enable row level security;
    create policy agenda_bloqueios_loja on agenda_bloqueios for all using (tem_loja(loja_id)) with check (tem_loja(loja_id));
    alter table agendamentos enable row level security;
    create policy agendamentos_loja on agendamentos for all using (tem_loja(loja_id)) with check (tem_loja(loja_id));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on agenda_config, agenda_bloqueios, agendamentos to app_api;
    grant execute on function agenda_livres(uuid, date, date), agenda_livres_equipe(uuid, date, date), agenda_livres_base(uuid, date, date, boolean), app_agenda_robo(uuid, timestamptz, jsonb),
      app_agenda_livres_robo(uuid, date, integer), app_agenda_loja_robo(uuid) to app_api;
  end if;
end $$;
