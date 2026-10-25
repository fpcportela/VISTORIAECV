-- =====================================================================
-- Cadastro de clientes: pessoa física, empresa e grupo de empresas
-- (um grupo reúne vários CNPJs; a venda é sempre feita para uma das empresas).
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

alter type tipo_pessoa add value if not exists 'grupo';

alter table clientes add column if not exists nome_fantasia text;
alter table clientes add column if not exists grupo_cliente_id uuid references clientes(id);
create index if not exists clientes_grupo on clientes(grupo_cliente_id) where grupo_cliente_id is not null;

-- O grupo não tem CPF/CNPJ próprio (os CNPJs são das empresas dele)
alter table clientes drop constraint if exists clientes_check;
alter table clientes drop constraint if exists clientes_documento;
alter table clientes add constraint clientes_documento check (tipo::text in ('avulso', 'grupo') or cpf_cnpj is not null);

drop trigger if exists aud_clientes on clientes;
create trigger aud_clientes after insert or update or delete on clientes for each row execute function auditar();
