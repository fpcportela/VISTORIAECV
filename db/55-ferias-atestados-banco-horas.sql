-- =====================================================================
-- Cadastro do colaborador: abas Férias e Atestados, e banco de horas.
--
-- Férias: período (início e fim) com a soma dos dias. Pode abonar horas do banco.
-- Banco de horas: liga por colaborador, com a jornada prevista de cada dia da semana.
--   Saldo do dia = horas trabalhadas no ponto - jornada prevista. Dia de férias ou de
--   atestado tem jornada zero. O dia de hoje só entra no dia seguinte.
-- Atestados: um atestado é um período de dias. Cada dia vira a justificativa do dia todo
--   na folha de ponto (ponto_justificativas com atestado_id). Marcar "atestado" numa
--   justificativa do espelho também cria o atestado, então as duas telas mostram o mesmo.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- Banco de horas do colaborador e jornada prevista (minutos de domingo a sábado)
alter table colaboradores add column if not exists banco_horas boolean not null default false;
alter table colaboradores add column if not exists banco_horas_inicio date;
alter table colaboradores add column if not exists jornada_minutos smallint[] not null default '{0,480,480,480,480,480,240}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'colaboradores_jornada_7_dias') then
    alter table colaboradores add constraint colaboradores_jornada_7_dias
      check (array_length(jornada_minutos, 1) = 7 and 0 <= all (jornada_minutos) and 1440 >= all (jornada_minutos));
  end if;
end $$;

-- Férias
create table if not exists colaborador_ferias (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references colaboradores(id) on delete cascade,
  inicio          date not null,
  fim             date not null,
  dias            integer generated always as (fim - inicio + 1) stored,
  abono_minutos   integer not null default 0,     -- horas do banco abonadas nestas férias (+ tira do saldo, - perdoa débito)
  observacao      text,
  criado_por      uuid references usuarios(id),
  criado_em       timestamptz not null default now(),
  check (fim >= inicio)
);
create index if not exists colaborador_ferias_colab on colaborador_ferias(colaborador_id, inicio);

-- Atestados: o período fica aqui; os dias são as justificativas ligadas a ele
create table if not exists colaborador_atestados (
  id              uuid primary key default gen_random_uuid(),
  colaborador_id  uuid not null references colaboradores(id) on delete cascade,
  inicio          date not null,
  fim             date not null,
  criado_por      uuid references usuarios(id),
  criado_em       timestamptz not null default now(),
  check (fim >= inicio)
);
create index if not exists colaborador_atestados_colab on colaborador_atestados(colaborador_id, inicio);

alter table ponto_justificativas add column if not exists atestado_id uuid references colaborador_atestados(id) on delete cascade;
create index if not exists ponto_justificativas_atestado on ponto_justificativas(atestado_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ponto_justificativas_atestado_dia') then
    alter table ponto_justificativas add constraint ponto_justificativas_atestado_dia check (atestado_id is null or tipo is null);
  end if;
end $$;

-- Quando um dia do atestado sai da folha (apagado ou desmarcado), o atestado encolhe;
-- sem nenhum dia, o atestado some
create or replace function atestado_acompanha_justificativa() returns trigger
language plpgsql as $$
declare
  a uuid := old.atestado_id;
begin
  if a is null or (tg_op = 'UPDATE' and new.atestado_id is not distinct from a) then return null; end if;
  if exists (select 1 from ponto_justificativas where atestado_id = a) then
    update colaborador_atestados set
      inicio = (select min(data) from ponto_justificativas where atestado_id = a),
      fim    = (select max(data) from ponto_justificativas where atestado_id = a)
     where id = a;
  else
    delete from colaborador_atestados where id = a;
  end if;
  return null;
end $$;
drop trigger if exists atestado_justificativa on ponto_justificativas;
create trigger atestado_justificativa after update of atestado_id or delete on ponto_justificativas
  for each row execute function atestado_acompanha_justificativa();

-- Banco de horas dia a dia: previsto, trabalhado e saldo (minutos), com o motivo de o dia
-- não contar (férias ou atestado). Segue as regras de acesso de quem consulta.
create or replace function banco_horas_dias(p_colab uuid, p_de date, p_ate date)
returns table (data date, previsto integer, trabalhado integer, saldo integer, motivo text)
language sql stable as $$
  with c as materialized (
    select id, jornada_minutos from colaboradores where id = p_colab
  ), dias as (
    select d::date as data from generate_series(p_de, p_ate, interval '1 day') d
  ), marcas as materialized (
    select r.data,
           max(r.hora) filter (where r.tipo = 'entrada')         as e,
           max(r.hora) filter (where r.tipo = 'saida_intervalo') as si,
           max(r.hora) filter (where r.tipo = 'volta_intervalo') as vi,
           max(r.hora) filter (where r.tipo = 'saida')           as s
      from ponto_registros r
     where r.colaborador_id = p_colab and r.ativo and r.data between p_de and p_ate
     group by r.data
  ), trecho as (
    -- igual ao espelho: manhã + tarde, ou entrada → saída quando não houve almoço
    select m.data,
           round(case when m.si is null and m.vi is null
                      then greatest(0, coalesce(extract(epoch from m.s - m.e), 0))
                      else greatest(0, coalesce(extract(epoch from m.si - m.e), 0))
                         + greatest(0, coalesce(extract(epoch from m.s - m.vi), 0)) end / 60)::int as minutos
      from marcas m
  ), fer as materialized (
    -- lidos uma vez só (as regras de acesso pesam se forem consultadas dia a dia)
    select f.inicio, f.fim from colaborador_ferias f
     where f.colaborador_id = p_colab and f.inicio <= p_ate and f.fim >= p_de
  ), ate as materialized (
    select j.data from ponto_justificativas j
     where j.colaborador_id = p_colab and j.atestado_id is not null and j.data between p_de and p_ate
  ), x as (
    select d.data,
           case when exists (select 1 from fer where d.data between fer.inicio and fer.fim) then 'ferias'
                when exists (select 1 from ate where ate.data = d.data) then 'atestado'
           end as motivo,
           c.jornada_minutos[extract(dow from d.data)::int + 1]::int as jornada,
           coalesce(t.minutos, 0) as trabalhado
      from dias d cross join c left join trecho t on t.data = d.data
  )
  select data, case when motivo is null then jornada else 0 end, trabalhado,
         trabalhado - case when motivo is null then jornada else 0 end, motivo
    from x order by data
$$;

-- Saldo do banco até ontem (o dia de hoje ainda está em andamento), já com os abonos das férias
create or replace function banco_horas_saldo(p_colab uuid)
returns table (calculado integer, abonado integer, saldo integer)
language sql stable as $$
  with c as (
    select banco_horas, banco_horas_inicio from colaboradores where id = p_colab
  ), calc as (
    select coalesce((select sum(b.saldo) from c, banco_horas_dias(p_colab, c.banco_horas_inicio,
             (now() at time zone 'America/Sao_Paulo')::date - 1) b
             where c.banco_horas and c.banco_horas_inicio is not null), 0)::int as v
  ), ab as (
    select coalesce((select sum(abono_minutos) from colaborador_ferias where colaborador_id = p_colab), 0)::int as v
  )
  select calc.v, ab.v, calc.v - ab.v from calc, ab
$$;

-- Acesso: segue o colaborador (quem vê o colaborador vê as férias e os atestados dele)
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'colaborador_ferias') then
    alter table colaborador_ferias enable row level security;
    create policy colaborador_ferias_por_colab on colaborador_ferias for all
      using (exists (select 1 from colaboradores c where c.id = colaborador_id))
      with check (exists (select 1 from colaboradores c where c.id = colaborador_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'colaborador_atestados') then
    alter table colaborador_atestados enable row level security;
    create policy colaborador_atestados_por_colab on colaborador_atestados for all
      using (exists (select 1 from colaboradores c where c.id = colaborador_id))
      with check (exists (select 1 from colaboradores c where c.id = colaborador_id));
  end if;
end $$;

drop trigger if exists aud_colaborador_ferias on colaborador_ferias;
create trigger aud_colaborador_ferias after insert or update or delete on colaborador_ferias for each row execute function auditar();
drop trigger if exists aud_colaborador_atestados on colaborador_atestados;
create trigger aud_colaborador_atestados after insert or update or delete on colaborador_atestados for each row execute function auditar();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on colaborador_ferias, colaborador_atestados to app_api;
    grant execute on function banco_horas_dias(uuid, date, date), banco_horas_saldo(uuid) to app_api;
  end if;
end $$;
