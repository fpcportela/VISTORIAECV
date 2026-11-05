-- Justificativa do ponto em cada marcação (entrada, saída almoço, volta almoço, saída).
-- Sem marcação (tipo nulo) = justificativa do dia todo (falta, atestado), como era antes.

alter table ponto_justificativas add column if not exists tipo tipo_marcacao_ponto;
alter table ponto_justificativas drop constraint if exists ponto_justificativas_colaborador_id_data_key;
create unique index if not exists ponto_justificativas_marcacao on ponto_justificativas (colaborador_id, data, tipo) where tipo is not null;
create unique index if not exists ponto_justificativas_dia on ponto_justificativas (colaborador_id, data) where tipo is null;
