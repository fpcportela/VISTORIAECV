-- Venda salva sem serviço: fica ABERTA (amarela) para ajustar depois.
-- Um veículo ainda sem serviço vira uma linha só com a placa (sem serviço, valor zero),
-- para a placa não se perder. Finalizar continua exigindo o serviço de cada veículo.

alter table venda_itens alter column servico_id drop not null;
alter table venda_itens drop constraint if exists venda_itens_so_placa;
alter table venda_itens add constraint venda_itens_so_placa
  check (servico_id is not null or (veiculo_id is not null and valor_unit = 0));

create or replace function vendas_exigir_servico() returns trigger
language plpgsql as $$
begin
  if new.situacao = 'finalizada' and old.situacao is distinct from 'finalizada' and (
       not exists (select 1 from venda_itens where venda_id = new.id and servico_id is not null)
       or exists (select 1 from venda_itens where venda_id = new.id and servico_id is null)) then
    raise exception 'Inclua o serviço de cada veículo antes de finalizar.' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_vendas_exigir_servico on vendas;
create trigger trg_vendas_exigir_servico before update of situacao on vendas
  for each row execute function vendas_exigir_servico();
