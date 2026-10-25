-- =====================================================================
-- Formas de pagamento da venda (pode ter mais de uma: parte em PIX, parte no cartão…)
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

create table if not exists venda_pagamentos (
  id              uuid primary key default gen_random_uuid(),
  venda_id        uuid not null references vendas(id) on delete cascade,
  data_pagamento  date not null,
  forma           forma_pagamento not null,
  valor           numeric(12,2) not null check (valor > 0),
  detalhe         text,                       -- ex.: maquininha, bandeira, banco do PIX
  criado_em       timestamptz not null default now()
);
create index if not exists venda_pagamentos_venda on venda_pagamentos(venda_id);

-- Acesso: o mesmo da venda
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'venda_pagamentos') then
    alter table venda_pagamentos enable row level security;
    create policy venda_pagamentos_por_venda on venda_pagamentos for all
      using (exists (select 1 from vendas v where v.id = venda_id))
      with check (exists (select 1 from vendas v where v.id = venda_id));
  end if;
end $$;

drop trigger if exists aud_venda_pagamentos on venda_pagamentos;
create trigger aud_venda_pagamentos after insert or update or delete on venda_pagamentos for each row execute function auditar();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on venda_pagamentos to app_api;
  end if;
end $$;
