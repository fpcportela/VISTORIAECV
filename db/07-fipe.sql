-- =====================================================================
-- Marcas e modelos de veículos (tabela FIPE), guardados para não depender
-- da internet a cada venda. Pode rodar de novo sem problema.
-- =====================================================================
create table if not exists fipe_marcas (
  tipo          tipo_veiculo not null,
  codigo        text not null,
  nome          text not null,
  atualizado_em timestamptz not null default now(),
  primary key (tipo, codigo)
);

create table if not exists fipe_modelos (
  tipo          tipo_veiculo not null,
  marca_codigo  text not null,
  codigo        text not null,
  nome          text not null,
  atualizado_em timestamptz not null default now(),
  primary key (tipo, marca_codigo, codigo)
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on fipe_marcas, fipe_modelos to app_api;
  end if;
end $$;
