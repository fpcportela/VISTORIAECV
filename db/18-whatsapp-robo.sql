-- Robô do WhatsApp: fluxo de atendimento configurável por grupo que coleta os dados
-- do cliente e do veículo e abre uma venda FUTURO. Opcionalmente conversa com IA
-- (Claude), só nos grupos em que o master liberou (depende do contrato).

-- IA liberada pelo master para o grupo (contrato)
alter table empresas add column if not exists ia_liberada boolean not null default false;

create or replace function empresas_ia_so_master() returns trigger
language plpgsql as $$
begin
  if new.ia_liberada is distinct from old.ia_liberada and not eh_admin_rede() then
    raise exception 'Só o master libera a IA do robô para o grupo.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_empresas_ia_so_master on empresas;
create trigger trg_empresas_ia_so_master before update on empresas
  for each row execute function empresas_ia_so_master();

create table if not exists whatsapp_robo (
  empresa_id      uuid primary key references empresas(id),
  ativo           boolean not null default false,
  saudacao        text,
  etapas          jsonb not null default '[]',   -- [{campo, pergunta, obrigatorio}]
  mensagem_final  text,
  loja_id         uuid references lojas(id),      -- loja em que a venda abre
  servico_id      uuid references servicos(id),   -- serviço usado se o fluxo não perguntar
  ia_ativa        boolean not null default false,
  ia_instrucoes   text,
  atualizado_em   timestamptz not null default now()
);

-- Estado do robô em cada atendimento (chamado): um chamado novo começa o fluxo do zero
alter table whatsapp_chamados add column if not exists robo_estado text
  check (robo_estado in ('coletando', 'concluido', 'humano'));
alter table whatsapp_chamados add column if not exists robo_etapa integer not null default 0;
alter table whatsapp_chamados add column if not exists robo_dados jsonb not null default '{}';
alter table whatsapp_chamados add column if not exists venda_id uuid references vendas(id) on delete set null;

-- Mensagem mandada pelo robô (e não por um atendente)
alter table whatsapp_conversa add column if not exists robo boolean not null default false;

-- Abre a venda FUTURO com os dados que o robô coletou (os dados já chegam conferidos pela API):
--   nome, cpf_cnpj, whatsapp, email, placa, tipo_veiculo, servico_id, data (AAAA-MM-DD), observacoes
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
    select c.id into v_cliente from clientes c where c.empresa_id = v_ch.empresa_id and c.cpf_cnpj = v_doc;
    if v_cliente is null then
      -- cadastro antigo do contato sem documento: completa o mesmo em vez de criar outro
      select c.id into v_cliente from clientes c
       where c.id = v_k.cliente_id and c.empresa_id = v_ch.empresa_id and c.cpf_cnpj is null
         and c.tipo = 'avulso' and c.nome <> 'CLIENTE PARTICULAR / AVULSO';
      if v_cliente is not null then
        update clientes set tipo = (case when length(v_doc) = 14 then 'pj' else 'pf' end)::tipo_pessoa,
               cpf_cnpj = v_doc, nome = coalesce(v_nome, nome) where id = v_cliente;
      else
        insert into clientes (empresa_id, tipo, nome, cpf_cnpj, whatsapp, email)
        values (v_ch.empresa_id, (case when length(v_doc) = 14 then 'pj' else 'pf' end)::tipo_pessoa,
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

  -- serviço: o escolhido na conversa ou o padrão do robô
  select * into v_servico from servicos s
   where s.empresa_id = v_ch.empresa_id and s.ativo
     and s.id = coalesce(nullif(p_dados->>'servico_id', '')::uuid, v_r.servico_id);
  if v_servico.id is null then
    select * into v_servico from servicos s where s.empresa_id = v_ch.empresa_id and s.ativo order by s.nome limit 1;
  end if;
  if v_servico.id is null then raise exception 'O grupo não tem serviço ativo para a venda.' using errcode = '22023'; end if;
  -- preço: o especial do cliente (db/26), senão o do serviço para o tipo de veículo
  v_valor := coalesce(
    (select cp.valor from cliente_precos cp where cp.cliente_id = v_cliente and cp.servico_id = v_servico.id),
    (select p.valor from servico_precos p where p.servico_id = v_servico.id and p.tipo_veiculo = v_tipo
                                             and (p.loja_id is null or p.loja_id = v_loja)
      order by p.loja_id nulls last limit 1),
    v_servico.valor_padrao, 0);

  v_desc := v_servico.nome;
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
  insert into venda_itens (venda_id, servico_id, veiculo_id, descricao, quantidade, valor_unit)
  values (v_venda, v_servico.id, v_veiculo, v_desc, 1, v_valor);
  insert into venda_historico (venda_id, usuario_id, acao, detalhe)
  values (v_venda, null, 'criada', 'Aberta pelo robô do WhatsApp (' || coalesce(v_nome, v_k.nome, v_k.telefone) || ')');

  update whatsapp_chamados set venda_id = v_venda, robo_estado = 'concluido', atualizado_em = now(),
         titulo = coalesce(titulo, 'VENDA Nº ' || v_numero)
   where id = v_ch.id;
  return query select v_venda, v_numero;
end $$;

-- O robô roda sem usuário logado (depois do webhook): estas funções dão só o que ele precisa.
-- Tudo do atendimento aberto do contato: configuração, chamado, serviços e as mensagens do chamado.
create or replace function app_robo_contexto(p_contato uuid) returns jsonb
language plpgsql security definer as $$
declare v_k whatsapp_contatos;
        v_ch whatsapp_chamados;
        v_r whatsapp_robo;
        v_cli clientes;
        v_nac text;
begin
  select * into v_k from whatsapp_contatos where id = p_contato;
  if v_k.id is null then return null; end if;
  select * into v_r from whatsapp_robo where empresa_id = v_k.empresa_id and ativo;
  if v_r.empresa_id is null then return null; end if;
  select * into v_ch from whatsapp_chamados where contato_id = v_k.id and aberto order by criado_em desc limit 1;
  if v_ch.id is null then return null; end if;

  -- Cliente do cadastro: o já ligado ao contato ou, se não houver, o único cliente com esse
  -- WhatsApp/telefone (mesmo DDD e mesmos 8 últimos dígitos, com ou sem o 9). Achou: fica ligado.
  select * into v_cli from clientes c where c.id = v_k.cliente_id and c.empresa_id = v_k.empresa_id and c.ativo;
  if v_cli.id is null then
    v_nac := regexp_replace(regexp_replace(v_k.telefone, '\D', '', 'g'), '^55(?=\d{10,11}$)', '');
    if length(v_nac) in (10, 11) then
      select * into v_cli from clientes c
       where c.empresa_id = v_k.empresa_id and c.ativo and c.tipo in ('pf', 'pj') and c.cpf_cnpj is not null
         and exists (select 1 from unnest(array[c.whatsapp, c.telefone]) t(n)
                      where length(regexp_replace(n, '\D', '', 'g')) in (10, 11)
                        and left(regexp_replace(n, '\D', '', 'g'), 2) = left(v_nac, 2)
                        and right(regexp_replace(n, '\D', '', 'g'), 8) = right(v_nac, 8))
       order by c.criado_em limit 2;
      if found and (select count(*) from clientes c
                     where c.empresa_id = v_k.empresa_id and c.ativo and c.tipo in ('pf', 'pj') and c.cpf_cnpj is not null
                       and exists (select 1 from unnest(array[c.whatsapp, c.telefone]) t(n)
                                    where length(regexp_replace(n, '\D', '', 'g')) in (10, 11)
                                      and left(regexp_replace(n, '\D', '', 'g'), 2) = left(v_nac, 2)
                                      and right(regexp_replace(n, '\D', '', 'g'), 8) = right(v_nac, 8))) = 1 then
        update whatsapp_contatos set cliente_id = v_cli.id where id = v_k.id;
      else
        v_cli := null;
      end if;
    end if;
  end if;

  return jsonb_build_object(
    -- unidades ativas do grupo, com endereço: com mais de uma, o robô pergunta qual
    'lojas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nome', l.nome, 'logradouro', l.logradouro, 'numero', l.numero,
                         'bairro', l.bairro, 'cidade', l.cidade, 'uf', l.uf, 'cep', l.cep,
                         'horarios', (select c.horarios from agenda_config c where c.loja_id = l.id and c.ativo)) order by l.nome)
                         from lojas l where l.empresa_id = v_k.empresa_id and l.ativo), '[]'),
    'cliente', case when v_cli.id is not null then jsonb_build_object('id', v_cli.id, 'nome', v_cli.nome,
                 'cpf_cnpj', v_cli.cpf_cnpj, 'email', v_cli.email) end,
    'empresa_id', v_k.empresa_id,
    'contato', jsonb_build_object('id', v_k.id, 'telefone', v_k.telefone, 'nome', v_k.nome, 'cliente_id', v_k.cliente_id),
    'chamado', jsonb_build_object('id', v_ch.id, 'robo_estado', v_ch.robo_estado, 'robo_etapa', v_ch.robo_etapa,
                                  'robo_dados', v_ch.robo_dados, 'venda_id', v_ch.venda_id),
    'phone_number_id', (select phone_number_id from whatsapp_numeros where empresa_id = v_k.empresa_id and ativo),
    'ia_liberada', (select ia_liberada from empresas where id = v_k.empresa_id),
    'robo', to_jsonb(v_r),
    'servicos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome) order by s.nome)
                            from servicos s where s.empresa_id = v_k.empresa_id and s.ativo), '[]'),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('direcao', m.direcao, 'texto', m.texto) order by m.criado_em)
                             from (select * from whatsapp_conversa m where m.chamado_id = v_ch.id
                                    order by m.criado_em desc limit 40) m), '[]'));
end $$;

create or replace function app_robo_estado(p_chamado uuid, p_estado text, p_etapa integer, p_dados jsonb) returns void
language sql security definer as $$
  update whatsapp_chamados set robo_estado = p_estado, robo_etapa = coalesce(p_etapa, robo_etapa),
         robo_dados = coalesce(p_dados, robo_dados), atualizado_em = now()
   where id = p_chamado and venda_id is null
$$;

-- Grava a mensagem que o robô mandou
create or replace function app_robo_registrar(p_chamado uuid, p_texto text, p_status text, p_erro text, p_id_externo text) returns void
language sql security definer as $$
  insert into whatsapp_conversa (empresa_id, contato_id, chamado_id, direcao, texto, status, erro, id_externo, robo)
  select h.empresa_id, h.contato_id, h.id, 'saida', p_texto, p_status, p_erro, p_id_externo, true
    from whatsapp_chamados h where h.id = p_chamado;
  update whatsapp_contatos set ultima_em = now() where id = (select contato_id from whatsapp_chamados where id = p_chamado);
$$;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'whatsapp_robo') then
    alter table whatsapp_robo enable row level security;
    create policy whatsapp_robo_grupo on whatsapp_robo for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on whatsapp_robo to app_api;
    grant execute on function app_robo_abrir_venda(uuid, jsonb), app_robo_contexto(uuid), app_robo_estado(uuid, text, integer, jsonb),
      app_robo_registrar(uuid, text, text, text, text) to app_api;
  end if;
end $$;
