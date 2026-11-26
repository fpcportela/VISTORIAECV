-- =====================================================================
-- WhatsApp: várias conexões (números) por grupo.
--   * Cada conexão é do grupo todo ou de uma unidade, tem um nome ("Loja Centro", "Vendas"…)
--     e pode usar o robô do grupo ou um robô próprio.
--   * Cada conversa (contato) é de uma conexão: a resposta sai pelo mesmo número que recebeu.
--     O mesmo celular pode ter uma conversa em cada conexão.
--   * Quem vê as conversas de cada conexão:
--       - padrão (como era antes): quem tem "WhatsApp" no perfil na unidade da conexão
--         (conexão do grupo todo: em qualquer unidade do grupo);
--       - usuário com "só as conexões marcadas" (tela Usuários, no cadastro do usuário):
--         só as conexões marcadas para ele, em qualquer unidade do grupo.
--     O perfil continua valendo: sem "WhatsApp" no perfil não vê nada. O master vê tudo.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- ------------------------------------------------------------ conexões
alter table whatsapp_numeros add column if not exists id uuid not null default gen_random_uuid();
alter table whatsapp_numeros add column if not exists nome text;
alter table whatsapp_numeros add column if not exists loja_id uuid references lojas(id) on delete set null;
alter table whatsapp_numeros add column if not exists robo_proprio boolean not null default false;
alter table whatsapp_numeros add column if not exists criado_em timestamptz not null default now();

-- A chave deixa de ser o grupo (um número por grupo) e passa a ser a própria conexão
do $$
begin
  if exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.conrelid = 'whatsapp_numeros'::regclass and c.contype = 'p' and a.attname = 'empresa_id') then
    alter table whatsapp_numeros drop constraint whatsapp_numeros_pkey;
    alter table whatsapp_numeros add constraint whatsapp_numeros_pkey primary key (id);
  end if;
end $$;
create index if not exists whatsapp_numeros_empresa on whatsapp_numeros(empresa_id);
update whatsapp_numeros set nome = 'WHATSAPP PRINCIPAL' where nome is null;

-- Usuário que só vê as conexões marcadas (falso = vê as conexões das unidades em que tem WhatsApp)
alter table usuarios add column if not exists whatsapp_restrito boolean not null default false;
create table if not exists whatsapp_numero_usuarios (
  numero_id   uuid not null references whatsapp_numeros(id) on delete cascade,
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  primary key (numero_id, usuario_id)
);
create index if not exists whatsapp_numero_usuarios_usuario on whatsapp_numero_usuarios(usuario_id);

-- ------------------------------------------------------------ conversas por conexão
alter table whatsapp_contatos add column if not exists numero_id uuid references whatsapp_numeros(id);
-- Conversas antigas (e as abertas quando o grupo ainda não tinha número) ficam na conexão que o grupo já tinha
update whatsapp_contatos k
   set numero_id = (select n.id from whatsapp_numeros n where n.empresa_id = k.empresa_id
                     order by n.ativo desc, (n.phone_number_id like 'teste-%'), n.criado_em limit 1)
 where k.numero_id is null
   and not exists (select 1 from whatsapp_contatos o
                    where o.empresa_id = k.empresa_id and o.telefone = k.telefone and o.numero_id is not null
                      and o.numero_id = (select n.id from whatsapp_numeros n where n.empresa_id = k.empresa_id
                                          order by n.ativo desc, (n.phone_number_id like 'teste-%'), n.criado_em limit 1));
alter table whatsapp_contatos drop constraint if exists whatsapp_contatos_empresa_id_telefone_key;
create unique index if not exists whatsapp_contatos_conexao_tel on whatsapp_contatos(empresa_id, numero_id, telefone) nulls not distinct;
create index if not exists whatsapp_contatos_numero on whatsapp_contatos(numero_id);

-- ------------------------------------------------------------ robô por conexão
-- A linha sem conexão (numero_id nulo) é o robô do grupo; uma conexão com "robô próprio" tem a sua.
alter table whatsapp_robo add column if not exists id uuid not null default gen_random_uuid();
alter table whatsapp_robo add column if not exists numero_id uuid references whatsapp_numeros(id) on delete cascade;
do $$
begin
  if exists (select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
              where c.conrelid = 'whatsapp_robo'::regclass and c.contype = 'p' and a.attname = 'empresa_id') then
    alter table whatsapp_robo drop constraint whatsapp_robo_pkey;
    alter table whatsapp_robo add constraint whatsapp_robo_pkey primary key (id);
  end if;
end $$;
create unique index if not exists whatsapp_robo_conexao on whatsapp_robo(empresa_id, numero_id) nulls not distinct;

-- ------------------------------------------------------------ quem vê
-- O usuário vê as conversas da conexão? (p_permissao: whatsapp.ver ou whatsapp.enviar)
create or replace function whatsapp_usuario_ve(p_usuario uuid, p_numero uuid, p_permissao text default 'whatsapp.ver')
returns boolean
language sql stable security definer as $$
  select coalesce((
    select case
             when u.admin_rede then true
             when not u.ativo then false
             -- só as marcadas: vale em qualquer unidade do grupo em que tenha a permissão
             when u.whatsapp_restrito then
               exists (select 1 from whatsapp_numero_usuarios x where x.numero_id = n.id and x.usuario_id = u.id)
               and exists (select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
                             join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
                            where ul.usuario_id = u.id and ul.ativo and l.empresa_id = n.empresa_id and pp.permissao = p_permissao)
             -- padrão: a unidade da conexão (conexão do grupo todo: qualquer unidade do grupo)
             else exists (select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
                            join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
                           where ul.usuario_id = u.id and ul.ativo and l.empresa_id = n.empresa_id and pp.permissao = p_permissao
                             and (n.loja_id is null or ul.loja_id = n.loja_id))
           end
      from usuarios u, whatsapp_numeros n
     where u.id = p_usuario and n.id = p_numero), false)
$$;

-- A pessoa logada vê a conversa? Conversa sem conexão (grupo sem número): quem tem a permissão no grupo.
create or replace function ve_whatsapp(p_numero uuid, p_empresa uuid, p_permissao text default 'whatsapp.ver')
returns boolean
language sql stable security definer as $$
  select tem_empresa(p_empresa) and case
           when eh_admin_rede() then true
           when p_numero is null then exists (select 1 from lojas l where l.empresa_id = p_empresa and pode(l.id, p_permissao))
           else whatsapp_usuario_ve(app_usuario_atual(), p_numero, p_permissao) end
$$;

-- Conexão que a unidade usa para mensagens que não vêm de uma conversa (agenda, comprovante do ponto):
-- a da própria unidade, senão a do grupo todo, senão qualquer uma do grupo
create or replace function whatsapp_numero_loja(p_loja uuid) returns uuid
language sql stable security definer as $$
  select n.id from whatsapp_numeros n join lojas l on l.empresa_id = n.empresa_id
   where l.id = p_loja and n.ativo
   order by (n.loja_id = l.id) desc nulls last, (n.loja_id is null) desc, (n.phone_number_id like 'teste-%'), n.criado_em
   limit 1
$$;

-- Robô que atende o chamado: o próprio da conexão (se ela tiver), senão o do grupo
create or replace function robo_do_chamado(p_chamado uuid) returns whatsapp_robo
language sql stable security definer as $$
  select r.* from whatsapp_chamados h
    join whatsapp_contatos k on k.id = h.contato_id
    left join whatsapp_numeros n on n.id = k.numero_id
    join whatsapp_robo r on r.empresa_id = h.empresa_id
                        and r.numero_id is not distinct from (case when n.robo_proprio then n.id end)
   where h.id = p_chamado
$$;

-- Acha (ou cria) a conversa do celular na conexão (roda com as regras de acesso de quem chama)
create or replace function app_whatsapp_contato(p_empresa uuid, p_numero uuid, p_telefone text, p_nome text, p_cliente uuid)
returns uuid
language sql as $$
  insert into whatsapp_contatos (empresa_id, numero_id, telefone, nome, cliente_id)
  values (p_empresa, p_numero, p_telefone, nullif(trim(p_nome), ''), p_cliente)
  on conflict (empresa_id, numero_id, telefone) do update
     set nome = coalesce(whatsapp_contatos.nome, excluded.nome),
         cliente_id = coalesce(whatsapp_contatos.cliente_id, excluded.cliente_id)
  returning id
$$;

-- Mensagem que chegou pelo webhook (sem usuário logado): a conversa é da conexão que recebeu
create or replace function app_whatsapp_receber(p_phone_number_id text, p_telefone text, p_nome text, p_texto text,
                                                p_id_externo text, p_quando timestamptz)
returns uuid
language plpgsql security definer as $$
declare v_n whatsapp_numeros;
        v_contato uuid;
        v_ch uuid;
begin
  select * into v_n from whatsapp_numeros where phone_number_id = p_phone_number_id and ativo;
  if v_n.id is null then return null; end if;
  if p_id_externo is not null and exists (select 1 from whatsapp_conversa where id_externo = p_id_externo) then return null; end if;
  insert into whatsapp_contatos (empresa_id, numero_id, telefone, nome) values (v_n.empresa_id, v_n.id, p_telefone, nullif(trim(p_nome), ''))
  on conflict (empresa_id, numero_id, telefone) do update set nome = coalesce(whatsapp_contatos.nome, excluded.nome)
  returning id into v_contato;
  v_ch := app_whatsapp_chamado_do_contato(v_n.empresa_id, v_contato, null);
  insert into whatsapp_conversa (empresa_id, contato_id, chamado_id, direcao, texto, status, id_externo, criado_em)
  values (v_n.empresa_id, v_contato, v_ch, 'entrada', p_texto, 'recebida', p_id_externo, coalesce(p_quando, now()));
  update whatsapp_contatos set nao_lidas = nao_lidas + 1, ultima_em = coalesce(p_quando, now()) where id = v_contato;
  update whatsapp_chamados set atualizado_em = now() where id = v_ch;
  return v_contato;
end $$;

-- Quem vê cada conexão (tela Usuários), só dos grupos da pessoa
drop function if exists app_whatsapp_acessos();
create or replace function app_whatsapp_acessos() returns table (usuario_id uuid, restrito boolean, numero_id uuid, ve boolean, marcada boolean)
language sql stable security definer as $$
  select u.id, u.whatsapp_restrito, n.id, whatsapp_usuario_ve(u.id, n.id),
         exists (select 1 from whatsapp_numero_usuarios x where x.numero_id = n.id and x.usuario_id = u.id)
    from whatsapp_numeros n
    join usuarios u on not u.admin_rede
                   and exists (select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
                                where ul.usuario_id = u.id and l.empresa_id = n.empresa_id)
   where n.phone_number_id not like 'teste-%'
     and (eh_admin_rede() or exists (select 1 from lojas l where l.empresa_id = n.empresa_id and pode(l.id, 'usuarios.ver')))
     and tem_empresa(n.empresa_id)
$$;

-- Define as conexões que o usuário vê. p_restrito falso = as das unidades dele (como era antes).
-- Só mexe nas conexões dos grupos em que quem salva pode gerenciar usuários.
create or replace function app_whatsapp_definir_usuario(p_usuario uuid, p_restrito boolean, p_numeros uuid[]) returns void
language plpgsql security definer as $$
begin
  if not (eh_admin_rede() or exists (
           select 1 from usuario_lojas ul join lojas l on l.id = ul.loja_id
            where ul.usuario_id = p_usuario and pode(ul.loja_id, 'usuarios.gerenciar'))) then
    raise exception 'Seu perfil não pode alterar o acesso deste usuário ao WhatsApp.' using errcode = '42501';
  end if;
  update usuarios set whatsapp_restrito = coalesce(p_restrito, false) where id = p_usuario;
  delete from whatsapp_numero_usuarios x
   using whatsapp_numeros n
   where x.numero_id = n.id and x.usuario_id = p_usuario
     and (eh_admin_rede() or exists (select 1 from lojas l where l.empresa_id = n.empresa_id and pode(l.id, 'usuarios.gerenciar')));
  insert into whatsapp_numero_usuarios (numero_id, usuario_id)
  select n.id, p_usuario from whatsapp_numeros n
   where n.id = any(coalesce(p_numeros, '{}'))
     and (eh_admin_rede() or exists (select 1 from lojas l where l.empresa_id = n.empresa_id and pode(l.id, 'usuarios.gerenciar')))
  on conflict do nothing;
end $$;

-- ------------------------------------------------------------ robô (funções que liam "o" robô do grupo)


-- Unidade da conversa: a escolhida pelo cliente, senão a do robô do grupo, senão a primeira ativa
create or replace function robo_unidade(p_empresa uuid, p_loja uuid) returns uuid
language sql stable security definer as $$
  select coalesce(
    (select l.id from lojas l where l.id = p_loja and l.empresa_id = p_empresa and l.ativo),
    (select l.id from whatsapp_robo r join lojas l on l.id = r.loja_id and l.ativo where r.empresa_id = p_empresa and r.numero_id is null),
    (select l.id from lojas l where l.empresa_id = p_empresa and l.ativo order by l.nome limit 1))
$$;

create or replace function app_agenda_livres_robo(p_empresa uuid, p_de date, p_limite integer)
returns table (inicio timestamptz, fim timestamptz)
language sql security definer as $$
  select f.inicio, f.fim
    from agenda_livres(coalesce(
           (select l.id from whatsapp_robo r join lojas l on l.id = r.loja_id and l.ativo where r.empresa_id = p_empresa and r.numero_id is null),
           (select l.id from lojas l where l.empresa_id = p_empresa and l.ativo order by l.nome limit 1)),
         p_de, p_de + 60) f
   order by f.inicio
   limit p_limite
$$;

create or replace function app_agenda_loja_robo(p_empresa uuid) returns jsonb
language sql stable security definer as $$
  select to_jsonb(x) from (
    select l.id, l.nome, l.logradouro, l.numero, l.bairro, l.cidade, l.uf
      from lojas l
     where l.id = coalesce((select r.loja_id from whatsapp_robo r join lojas k on k.id = r.loja_id and k.ativo where r.empresa_id = p_empresa and r.numero_id is null),
                           (select k.id from lojas k where k.empresa_id = p_empresa and k.ativo order by k.nome limit 1))) x
$$;

-- Passa o chamado do robô para o responsável do robô que atende (o da unidade, senão o padrão), se ainda não tem um
create or replace function app_robo_atribuir(p_chamado uuid, p_loja uuid) returns void
language sql security definer as $$
  update whatsapp_chamados h
     set responsavel_id = u.id, atualizado_em = now()
    from usuarios u
   where h.id = p_chamado and h.responsavel_id is null and u.ativo
     and u.id = (select coalesce(nullif(r.responsaveis->>(robo_unidade(h.empresa_id, p_loja)::text), '')::uuid, r.responsavel_id)
                   from robo_do_chamado(h.id) r)
$$;

-- (igual ao db/51; muda só o robô usado: o da conexão da conversa)
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
  v_r := robo_do_chamado(v_ch.id);  -- o robô da conexão (ou o do grupo)
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

-- (igual ao db/51; muda só o robô usado: o da conexão da conversa)
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
  v_r := robo_do_chamado(v_ch.id);  -- o robô da conexão (ou o do grupo)
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

-- Contexto do robô (igual ao db/18): robô da conexão, unidades da conexão e o número que recebeu
create or replace function app_robo_contexto(p_contato uuid) returns jsonb
language plpgsql security definer as $$
declare v_k whatsapp_contatos;
        v_n whatsapp_numeros;
        v_ch whatsapp_chamados;
        v_r whatsapp_robo;
        v_cli clientes;
        v_nac text;
begin
  select * into v_k from whatsapp_contatos where id = p_contato;
  if v_k.id is null then return null; end if;
  select * into v_n from whatsapp_numeros where id = v_k.numero_id;
  -- robô da conexão (se ela tiver um próprio), senão o do grupo
  select * into v_r from whatsapp_robo
   where empresa_id = v_k.empresa_id and ativo and numero_id is not distinct from (case when v_n.robo_proprio then v_n.id end);
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
                         from lojas l where l.empresa_id = v_k.empresa_id and l.ativo
                          -- conexão de uma unidade só: o robô não pergunta a unidade
                          and (v_n.loja_id is null or l.id = v_n.loja_id)), '[]'),
    'cliente', case when v_cli.id is not null then jsonb_build_object('id', v_cli.id, 'nome', v_cli.nome,
                 'cpf_cnpj', v_cli.cpf_cnpj, 'email', v_cli.email) end,
    'empresa_id', v_k.empresa_id,
    'contato', jsonb_build_object('id', v_k.id, 'telefone', v_k.telefone, 'nome', v_k.nome, 'cliente_id', v_k.cliente_id),
    'chamado', jsonb_build_object('id', v_ch.id, 'robo_estado', v_ch.robo_estado, 'robo_etapa', v_ch.robo_etapa,
                                  'robo_dados', v_ch.robo_dados, 'venda_id', v_ch.venda_id),
    'phone_number_id', coalesce(case when v_n.ativo then v_n.phone_number_id end,
                              (select n.phone_number_id from whatsapp_numeros n where n.id = whatsapp_numero_loja(
                                 (select l.id from lojas l where l.empresa_id = v_k.empresa_id and l.ativo order by l.nome limit 1)))),
    'numero_id', v_k.numero_id,
    'ia_liberada', (select ia_liberada from empresas where id = v_k.empresa_id),
    'robo', to_jsonb(v_r),
    'servicos', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nome', s.nome) order by s.nome)
                            from servicos s where s.empresa_id = v_k.empresa_id and s.ativo), '[]'),
    'mensagens', coalesce((select jsonb_agg(jsonb_build_object('direcao', m.direcao, 'texto', m.texto, 'em', m.criado_em, 'robo', m.robo) order by m.criado_em)
                             from (select * from whatsapp_conversa m where m.chamado_id = v_ch.id
                                    order by m.criado_em desc limit 40) m), '[]'));
end $$;

-- Confirmação pendente (igual ao db/32): responde pelo número da conversa
create or replace function app_agenda_confirmacao_pendente(p_contato uuid) returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
           'ag', to_jsonb(a), 'loja', to_jsonb(l), 'telefone', k.telefone, 'phone_number_id', n.phone_number_id,
           'chamado_id', (select h.id from whatsapp_chamados h where h.contato_id = k.id and h.aberto order by h.criado_em desc limit 1),
           'ultima', (select m.texto from whatsapp_conversa m where m.contato_id = k.id and m.direcao = 'entrada' order by m.criado_em desc limit 1))
    from whatsapp_contatos k
    join agendamentos a on a.empresa_id = k.empresa_id and a.confirmacao_etapa is not null
                       and a.situacao in ('agendado', 'confirmado') and a.inicio > now() - interval '12 hours'
                       and tel_chave(a.telefone) = tel_chave(k.telefone)
    join lojas l on l.id = a.loja_id
    left join whatsapp_numeros n on n.id = coalesce(k.numero_id, whatsapp_numero_loja(a.loja_id)) and n.ativo
   where k.id = p_contato
   order by a.confirmacao_em desc nulls last
   limit 1
$$;

-- ------------------------------------------------------------ acesso da API
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'whatsapp_numero_usuarios') then
    alter table whatsapp_numero_usuarios enable row level security;
    create policy whatsapp_numero_usuarios_grupo on whatsapp_numero_usuarios for all
      using (exists (select 1 from whatsapp_numeros n where n.id = numero_id and tem_empresa(n.empresa_id)))
      with check (exists (select 1 from whatsapp_numeros n where n.id = numero_id and tem_empresa(n.empresa_id)));
  end if;
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on whatsapp_numero_usuarios to app_api;
    grant execute on function whatsapp_usuario_ve(uuid, uuid, text), ve_whatsapp(uuid, uuid, text), whatsapp_numero_loja(uuid),
      robo_do_chamado(uuid), app_whatsapp_contato(uuid, uuid, text, text, uuid), app_whatsapp_acessos(),
      app_whatsapp_definir_usuario(uuid, boolean, uuid[]) to app_api;
  end if;
end $$;
