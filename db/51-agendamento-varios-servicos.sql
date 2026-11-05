-- Agendamento com vários serviços (pedido do Fabio, 2026-11-03): o cliente pode escolher mais de um
-- serviço no robô do WhatsApp e na tela "Agendar vistoria". A lista fica em agendamentos.servico_ids
-- (na ordem escolhida); servico_id continua sendo o primeiro, para o que ainda lê só um.
-- A venda aberta pelo robô ganha um item por serviço. Pode rodar de novo sem problema.

alter table agendamentos add column if not exists servico_ids uuid[] not null default '{}';
update agendamentos set servico_ids = array[servico_id] where servico_id is not null and cardinality(servico_ids) = 0;

-- servico_id acompanha a lista (e quem ainda grava só servico_id vira uma lista de um)
create or replace function agendamento_servicos_sincroniza() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if cardinality(new.servico_ids) > 0 then new.servico_id := new.servico_ids[1];
    elsif new.servico_id is not null then new.servico_ids := array[new.servico_id];
    end if;
  elsif new.servico_ids is distinct from old.servico_ids then
    new.servico_id := new.servico_ids[1];
  elsif new.servico_id is distinct from old.servico_id then
    new.servico_ids := case when new.servico_id is null then '{}'::uuid[] else array[new.servico_id] end;
  end if;
  return new;
end $$;
drop trigger if exists trg_agendamento_servicos on agendamentos;
create trigger trg_agendamento_servicos before insert or update of servico_id, servico_ids on agendamentos
  for each row execute function agendamento_servicos_sincroniza();

-- Serviços do grupo pedidos em p_dados: servico_ids (lista) ou servico_id (um só). Mantém a ordem,
-- tira repetidos e o que não é do grupo (p_ativos: só os ativos).
create or replace function servicos_da_lista(p_empresa uuid, p_dados jsonb, p_ativos boolean) returns uuid[]
language sql stable security definer as $$
  select coalesce(array_agg(s.id order by x.n), '{}')
    from (select distinct on (id) id, n
            from jsonb_array_elements_text(case
                   when jsonb_typeof(p_dados->'servico_ids') = 'array' and jsonb_array_length(p_dados->'servico_ids') > 0 then p_dados->'servico_ids'
                   when coalesce(p_dados->>'servico_id', '') <> '' then jsonb_build_array(p_dados->>'servico_id')
                   else '[]'::jsonb end) with ordinality as e(id, n)
           order by id, n) x
    join servicos s on s.id::text = x.id and s.empresa_id = p_empresa and (s.ativo or not p_ativos)
$$;

-- Robô agenda com todos os serviços escolhidos
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
  insert into agendamentos (empresa_id, loja_id, inicio, fim, origem, nome, telefone, placa, servico_ids, cliente_id, venda_id, chamado_id, observacao)
  values (v_ch.empresa_id, v_loja, p_inicio, v_fim, 'whatsapp',
          coalesce(nullif(upper(trim(p_dados->>'nome')), ''), (select nome from whatsapp_contatos where id = v_ch.contato_id), 'CLIENTE WHATSAPP'),
          coalesce(nullif(p_dados->>'telefone', ''), (select telefone from whatsapp_contatos where id = v_ch.contato_id)),
          nullif(p_dados->>'placa', ''),
          servicos_da_lista(v_ch.empresa_id, p_dados, false),
          (select cliente_id from whatsapp_contatos where id = v_ch.contato_id),
          v_ch.venda_id, v_ch.id, nullif(p_dados->>'observacao', ''))
  returning id into v_id;
  if v_ch.venda_id is not null then
    update vendas set data_venda = (p_inicio at time zone 'America/Sao_Paulo')::date where id = v_ch.venda_id and situacao = 'futuro';
  end if;
  return v_id;
end $$;


-- Venda aberta pelo robô do WhatsApp: um item por serviço escolhido
create or replace function app_robo_abrir_venda(p_chamado uuid, p_dados jsonb)
returns table (venda_id uuid, numero bigint)
language plpgsql security definer as $$
declare v_ch whatsapp_chamados;
        v_k whatsapp_contatos;
        v_r whatsapp_robo;
        v_loja uuid;
        v_cliente uuid;
        v_doc text := nullif(regexp_replace(coalesce(p_dados->>'cpf_cnpj', ''), '\D', '', 'g'), '');
        v_nome text := nullif(upper(trim(coalesce(p_dados->>'nome', ''))), '');
        v_veiculo uuid;
        v_placa text := nullif(upper(regexp_replace(coalesce(p_dados->>'placa', ''), '[^A-Za-z0-9]', '', 'g')), '');
        v_tipo tipo_veiculo := coalesce(nullif(p_dados->>'tipo_veiculo', '')::tipo_veiculo, 'carro');
        v_servico servicos;
        v_ids uuid[];
        v_valor numeric(12,2);
        v_desc text;
        v_venda uuid;
        v_numero bigint;
begin
  select * into v_ch from whatsapp_chamados where id = p_chamado for update;
  if v_ch.id is null then raise exception 'Chamado não encontrado.' using errcode = '22023'; end if;
  if v_ch.venda_id is not null then
    return query select v.id, v.numero from vendas v where v.id = v_ch.venda_id;
    return;
  end if;
  select * into v_k from whatsapp_contatos where id = v_ch.contato_id;
  select * into v_r from whatsapp_robo where empresa_id = v_ch.empresa_id;
  v_loja := coalesce(
    -- unidade que o cliente escolheu na conversa
    (select l.id from lojas l where l.id::text = p_dados->>'loja_id' and l.ativo and l.empresa_id = v_ch.empresa_id),
    (select l.id from lojas l where l.id = v_r.loja_id and l.ativo and l.empresa_id = v_ch.empresa_id),
    (select l.id from lojas l where l.empresa_id = v_ch.empresa_id and l.ativo order by l.nome limit 1));
  if v_loja is null then raise exception 'O grupo não tem loja ativa para abrir a venda.' using errcode = '22023'; end if;

  -- cliente: sempre pelo CPF/CNPJ (o já cadastrado ou um novo; nunca duplica). Sem documento não cadastra
  -- ninguém: usa o cliente já ligado ao contato ou o particular/avulso.
  if length(v_doc) not in (11, 14) then v_doc := null; end if;
  if v_doc is not null then
    -- com clientes separados por unidade (Grupos e unidades), procura só na unidade da venda
    select c.id into v_cliente from clientes c
     where c.empresa_id = v_ch.empresa_id and c.cpf_cnpj = v_doc
       and (compartilha(v_ch.empresa_id, 'clientes') or c.loja_id is null or c.loja_id = v_loja)
     order by c.loja_id = v_loja desc nulls last limit 1;
    if v_cliente is null then
      -- cadastro antigo do contato sem documento: completa o mesmo em vez de criar outro
      select c.id into v_cliente from clientes c
       where c.id = v_k.cliente_id and c.empresa_id = v_ch.empresa_id and c.cpf_cnpj is null
         and c.tipo = 'avulso' and c.nome <> 'CLIENTE PARTICULAR / AVULSO';
      if v_cliente is not null then
        update clientes set tipo = (case when length(v_doc) = 14 then 'pj' else 'pf' end)::tipo_pessoa,
               cpf_cnpj = v_doc, nome = coalesce(v_nome, nome) where id = v_cliente;
      else
        insert into clientes (empresa_id, loja_id, tipo, nome, cpf_cnpj, whatsapp, email)
        values (v_ch.empresa_id, v_loja, (case when length(v_doc) = 14 then 'pj' else 'pf' end)::tipo_pessoa,
                coalesce(v_nome, v_k.nome, 'CLIENTE WHATSAPP'), v_doc,
                nullif(p_dados->>'whatsapp', ''), nullif(lower(p_dados->>'email'), ''))
        returning id into v_cliente;
      end if;
    end if;
    update whatsapp_contatos set cliente_id = v_cliente where id = v_k.id;
  else
    v_cliente := (select c.id from clientes c where c.id = v_k.cliente_id and c.empresa_id = v_ch.empresa_id);
    if v_cliente is null then
      select c.id into v_cliente from clientes c
       where c.empresa_id = v_ch.empresa_id and c.tipo = 'avulso' and c.nome = 'CLIENTE PARTICULAR / AVULSO' limit 1;
    end if;
    if v_cliente is null then
      insert into clientes (empresa_id, tipo, nome) values (v_ch.empresa_id, 'avulso', 'CLIENTE PARTICULAR / AVULSO')
      returning id into v_cliente;
    end if;
  end if;
  update whatsapp_contatos set nome = coalesce(nome, v_nome) where id = v_k.id;

  -- serviços: os escolhidos na conversa (um ou mais), senão o padrão do robô, senão o primeiro ativo
  v_ids := servicos_da_lista(v_ch.empresa_id, p_dados, true);
  if cardinality(v_ids) = 0 then
    v_ids := coalesce((select array[s.id] from servicos s where s.empresa_id = v_ch.empresa_id and s.ativo and s.id = v_r.servico_id),
                      (select array[s.id] from servicos s where s.empresa_id = v_ch.empresa_id and s.ativo order by s.nome limit 1), '{}');
  end if;
  if cardinality(v_ids) = 0 then raise exception 'O grupo não tem serviço ativo para a venda.' using errcode = '22023'; end if;

  v_desc := null;
  if v_placa is not null then
    insert into veiculos (placa, tipo) values (v_placa, v_tipo)
    on conflict (placa) do update set tipo = excluded.tipo
    returning id into v_veiculo;
    select coalesce(nullif(concat_ws(' ', ve.marca, ve.modelo), '') || ' // ', '') || ve.placa into v_desc from veiculos ve where ve.id = v_veiculo;
  end if;

  insert into vendas (loja_id, empresa_id, numero, tipo, situacao, cliente_id, data_venda, categoria_id, observacoes)
  values (v_loja, v_ch.empresa_id, 0, 'venda_avulsa', 'futuro', v_cliente,
          coalesce(nullif(p_dados->>'data', '')::date, (now() at time zone 'America/Sao_Paulo')::date),
          (select id from categorias_financeiras where empresa_id = v_ch.empresa_id and tipo = 'receber' and ativo
            order by nome = 'Receitas de Serviços' desc, nome limit 1),
          nullif(p_dados->>'observacoes', ''))
  returning id, vendas.numero into v_venda, v_numero;
  -- um item por serviço, cada um com o seu preço: o especial do cliente (db/26), senão o do serviço
  -- para o tipo de veículo, senão o valor padrão
  for i in 1 .. cardinality(v_ids) loop
    select * into v_servico from servicos where id = v_ids[i];
    v_valor := coalesce(
      (select cp.valor from cliente_precos cp where cp.cliente_id = v_cliente and cp.servico_id = v_servico.id),
      (select p.valor from servico_precos p where p.servico_id = v_servico.id and p.tipo_veiculo = v_tipo
                                               and (p.loja_id is null or p.loja_id = v_loja)
        order by p.loja_id nulls last limit 1),
      v_servico.valor_padrao, 0);
    insert into venda_itens (venda_id, servico_id, veiculo_id, descricao, quantidade, valor_unit)
    values (v_venda, v_servico.id, v_veiculo, coalesce(v_desc, v_servico.nome), 1, v_valor);
  end loop;
  insert into venda_historico (venda_id, usuario_id, acao, detalhe)
  values (v_venda, null, 'criada', 'Aberta pelo robô do WhatsApp (' || coalesce(v_nome, v_k.nome, v_k.telefone) || ')');

  update whatsapp_chamados set venda_id = v_venda, robo_estado = 'concluido', atualizado_em = now(),
         titulo = coalesce(titulo, 'VENDA Nº ' || v_numero)
   where id = v_ch.id;
  return query select v_venda, v_numero;
end $$;


-- Robô abriu a venda: o agendamento da conversa fica com os serviços finais
create or replace function chamado_liga_agendamento() returns trigger
language plpgsql security definer as $$
begin
  if new.venda_id is not null and old.venda_id is null then
    update agendamentos a
       set venda_id = new.venda_id,
           nome = coalesce(nullif(upper(trim(new.robo_dados->>'nome')), ''), a.nome),
           placa = coalesce(nullif(new.robo_dados->>'placa', ''), a.placa),
           servico_ids = coalesce(nullif(servicos_da_lista(new.empresa_id, new.robo_dados, false), '{}'), a.servico_ids),
           -- só liga a um cliente cadastrado (com CPF/CNPJ), nunca ao particular/avulso
           cliente_id = coalesce((select v.cliente_id from vendas v join clientes c on c.id = v.cliente_id
                                   where v.id = new.venda_id and c.cpf_cnpj is not null), a.cliente_id),
           atualizado_em = now()
     where a.chamado_id = new.id and a.venda_id is null and a.situacao <> 'cancelado';
  end if;
  return null;
end $$;


do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function servicos_da_lista(uuid, jsonb, boolean) to app_api;
  end if;
end $$;
