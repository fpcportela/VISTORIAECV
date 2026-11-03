-- O chamado do WhatsApp sai da coluna AGENDADO e vai para a coluna que conclui (FINALIZADOS) quando:
--   * a venda dele é cancelada (à mão em Vendas, ou sozinha pelo agendamento CANCELADO ou FALTOU, db/52);
--   * o agendamento vira FALTOU (o automático das 24 h ou à mão), igual ao CANCELADO do db/49.
-- Também acerta os chamados que já estavam parados com venda cancelada ou agendamento FALTOU.
-- Pode rodar de novo sem problema.

-- Encerra um chamado aberto: vai para a primeira coluna que conclui, como o botão Encerrar
create or replace function app_chamado_encerrar(p_ch uuid, p_titulo text) returns void
language plpgsql security definer as $$
declare col uuid;
begin
  if p_ch is null then return; end if;
  select c.id into col from whatsapp_colunas c join whatsapp_chamados h on h.empresa_id = c.empresa_id
   where h.id = p_ch and c.finaliza order by c.ordem limit 1;
  if col is null then return; end if;
  update whatsapp_chamados set coluna_id = col, aberto = false, concluido_em = now(), atualizado_em = now(),
         titulo = coalesce(titulo, p_titulo)
   where id = p_ch and aberto;
end $$;

-- Agendamento CANCELADO ou FALTOU: encerra o chamado (db/49 fazia só o CANCELADO)
create or replace function trg_agenda_cancelado_chamado() returns trigger language plpgsql security definer as $$
begin
  if new.situacao not in ('cancelado', 'faltou') or old.situacao in ('cancelado', 'faltou') then return null; end if;
  update agendamentos set confirmacao_etapa = null, confirmacao_dados = null where id = new.id and confirmacao_etapa is not null;
  perform app_chamado_encerrar(coalesce(new.chamado_id, app_agendamento_chamado(new.id)),
                               case when new.situacao = 'faltou' then 'CLIENTE FALTOU' else 'AGENDAMENTO CANCELADO' end);
  return null;
end $$;

-- Venda CANCELADA: encerra o chamado ligado a ela (pelo venda_id do chamado ou pelo agendamento da venda)
create or replace function trg_venda_cancelada_chamado() returns trigger language plpgsql security definer as $$
declare ch uuid;
begin
  if new.situacao <> 'cancelada' or old.situacao = 'cancelada' then return null; end if;
  for ch in
    select id from whatsapp_chamados where venda_id = new.id and aberto
    union
    select a.chamado_id from agendamentos a where a.venda_id = new.id and a.chamado_id is not null
  loop
    perform app_chamado_encerrar(ch, 'VENDA CANCELADA');
  end loop;
  return null;
end $$;

drop trigger if exists trg_venda_cancelada_chamado on vendas;
create trigger trg_venda_cancelada_chamado after update of situacao on vendas
  for each row execute function trg_venda_cancelada_chamado();

-- Chamados que ficaram abertos com a venda já cancelada ou o agendamento já FALTOU/CANCELADO
-- (só os ligados direto; um agendamento ainda ativo no mesmo chamado mantém o chamado aberto)
select app_chamado_encerrar(h.id, 'VENDA CANCELADA')
  from whatsapp_chamados h join vendas v on v.id = h.venda_id
 where h.aberto and v.situacao = 'cancelada';

select app_chamado_encerrar(h.id, case when a.situacao = 'faltou' then 'CLIENTE FALTOU' else 'AGENDAMENTO CANCELADO' end)
  from whatsapp_chamados h join agendamentos a on a.chamado_id = h.id
 where h.aberto and a.situacao in ('faltou', 'cancelado')
   and not exists (select 1 from agendamentos b where b.chamado_id = h.id
                     and b.situacao in ('agendado', 'confirmado') );
