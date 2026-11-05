-- Situação FUTURO: venda aberta pelo robô do WhatsApp (ou agendada) que ainda
-- precisa ser confirmada pela loja. Pode ser editada como uma venda aberta.
alter type situacao_venda add value if not exists 'futuro' before 'finalizada';

create or replace function venda_itens_travar() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from vendas where id = coalesce(new.venda_id, old.venda_id) and situacao not in ('aberta', 'futuro')) then
    raise exception 'A venda não está aberta. Peça a liberação para alterar os itens.' using errcode = '22023';
  end if;
  return coalesce(new, old);
end $$;
