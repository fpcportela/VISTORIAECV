-- =====================================================================
-- Colaborador com acesso ao sistema (usuário e senha), "Esqueci a senha"
-- com código pelo WhatsApp, e o módulo WhatsApp (conversas e chamados em kanban).
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- ------------------------------------------------------------ colaborador com login
alter table colaboradores add column if not exists usuario_id uuid unique references usuarios(id) on delete set null;

-- Dá (ou tira) o acesso do colaborador. O "usuário" fica na coluna email dos usuários:
-- pode ser um e-mail ou um nome simples (ex.: joao.silva). O login aceita os dois.
create or replace function app_colaborador_acesso(p_colab uuid, p_acessa boolean, p_login text, p_senha text, p_perfil uuid)
returns uuid
language plpgsql security definer as $$
declare v_c colaboradores;
        v_login text := lower(trim(coalesce(p_login, '')));
        v_vinculos jsonb;
        v_uid uuid;
begin
  select * into v_c from colaboradores where id = p_colab;
  if v_c.id is null or not pode_colaborador(p_colab, 'colaboradores.editar') then
    raise exception 'sem_permissao' using errcode = '42501';
  end if;

  if not coalesce(p_acessa, false) then
    if v_c.usuario_id is not null then
      if not eh_admin_rede() and not exists (select 1 from usuario_lojas x
                                              where x.usuario_id = v_c.usuario_id and pode(x.loja_id, 'usuarios.gerenciar')) then
        raise exception 'sem_permissao' using errcode = '42501';
      end if;
      update usuarios set ativo = false, atualizado_em = now() where id = v_c.usuario_id and not admin_rede;
    end if;
    return v_c.usuario_id;
  end if;

  if v_login !~ '^[a-z0-9._@-]{3,80}$' then
    raise exception 'Usuário inválido: use de 3 a 80 letras, números, ponto, hífen ou um e-mail (sem espaço).' using errcode = '22023';
  end if;
  if exists (select 1 from usuarios where email = v_login and id is distinct from v_c.usuario_id) then
    raise exception 'Já existe alguém com esse usuário. Escolha outro.' using errcode = '22023';
  end if;
  if p_perfil is null then
    raise exception 'Escolha o perfil de acesso do colaborador.' using errcode = '22023';
  end if;
  if v_c.celular is null then
    raise exception 'Informe o celular do colaborador: é por ele que chega o código de "Esqueci a senha".' using errcode = '22023';
  end if;

  select jsonb_agg(jsonb_build_object('loja_id', cl.loja_id, 'perfil_id', p_perfil)) into v_vinculos
    from colaborador_lojas cl where cl.colaborador_id = p_colab;
  v_uid := app_salvar_usuario(v_c.usuario_id, v_c.nome, v_login, nullif(p_senha, ''), true, coalesce(v_vinculos, '[]'),
                              (select v_c.cpf where not exists (select 1 from usuarios u where u.cpf = v_c.cpf and u.id is distinct from v_c.usuario_id)),
                              v_c.celular);
  update colaboradores set usuario_id = v_uid where id = p_colab;
  if v_c.cargo_id is not null then perform app_definir_cargo(v_uid, v_c.cargo_id); end if;
  return v_uid;
end $$;

-- Acesso do colaborador para a tela de cadastro
create or replace function app_colaborador_ver_acesso(p_colab uuid)
returns table (usuario_id uuid, login text, ativo boolean, perfil_id uuid)
language sql stable security definer as $$
  select u.id, u.email, u.ativo,
         (select ul.perfil_id from usuario_lojas ul where ul.usuario_id = u.id order by ul.perfil_id limit 1)
    from colaboradores c join usuarios u on u.id = c.usuario_id
   where c.id = p_colab
     and (pode_colaborador(p_colab, 'colaboradores.ver') or pode_colaborador(p_colab, 'colaboradores.editar'))
$$;

-- ------------------------------------------------------------ esqueci a senha
create table if not exists senha_codigos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  codigo_hash text not null,
  expira_em   timestamptz not null,
  tentativas  integer not null default 0,
  usado       boolean not null default false,
  criado_em   timestamptz not null default now()
);
create index if not exists senha_codigos_usuario on senha_codigos(usuario_id, criado_em desc);
alter table senha_codigos enable row level security;  -- só as funções abaixo mexem nela

-- ------------------------------------------------------------ WhatsApp
-- Número do WhatsApp de cada grupo (id do número na API oficial da Meta)
create table if not exists whatsapp_numeros (
  empresa_id       uuid primary key references empresas(id),
  phone_number_id  text not null unique,
  numero           text,                 -- só para mostrar na tela
  ativo            boolean not null default true,
  atualizado_em    timestamptz not null default now()
);

-- Pessoas que falaram com o grupo pelo WhatsApp
create table if not exists whatsapp_contatos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id),
  telefone      text not null,           -- internacional, só números (5511987654321)
  nome          text,
  cliente_id    uuid references clientes(id) on delete set null,
  nao_lidas     integer not null default 0,
  ultima_em     timestamptz,
  criado_em     timestamptz not null default now(),
  unique (empresa_id, telefone)
);

-- Colunas do kanban de chamados (configuráveis por grupo)
create table if not exists whatsapp_colunas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id),
  nome        text not null,
  ordem       integer not null default 0,
  finaliza    boolean not null default false,   -- chamado que entra aqui fica concluído
  criado_em   timestamptz not null default now()
);
create unique index if not exists whatsapp_colunas_nome on whatsapp_colunas(empresa_id, lower(nome));

create table if not exists whatsapp_chamados (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id),
  contato_id      uuid not null references whatsapp_contatos(id) on delete cascade,
  coluna_id       uuid not null references whatsapp_colunas(id),
  titulo          text,
  responsavel_id  uuid references usuarios(id) on delete set null,
  ordem           double precision not null default 0,
  aberto          boolean not null default true,
  criado_por      uuid references usuarios(id),
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  concluido_em    timestamptz
);
create index if not exists whatsapp_chamados_coluna on whatsapp_chamados(coluna_id, ordem);
create index if not exists whatsapp_chamados_contato on whatsapp_chamados(contato_id) where aberto;

create table if not exists whatsapp_conversa (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id),
  contato_id    uuid not null references whatsapp_contatos(id) on delete cascade,
  chamado_id    uuid references whatsapp_chamados(id) on delete set null,
  direcao       text not null check (direcao in ('entrada', 'saida')),
  texto         text not null,
  status        text not null default 'enviada' check (status in ('recebida', 'enviada', 'entregue', 'lida', 'falhou', 'simulada')),
  erro          text,
  id_externo    text unique,
  enviado_por   uuid references usuarios(id),
  criado_em     timestamptz not null default now()
);
create index if not exists whatsapp_conversa_contato on whatsapp_conversa(contato_id, criado_em);

-- Colunas padrão para cada grupo
create or replace function app_whatsapp_colunas_padrao(p_empresa uuid) returns void
language sql security definer as $$
  insert into whatsapp_colunas (empresa_id, nome, ordem, finaliza)
  select p_empresa, n, o, f from (values ('NOVO', 1, false), ('EM ATENDIMENTO', 2, false),
                                         ('AGUARDANDO CLIENTE', 3, false), ('CONCLUIDO', 4, true)) v(n, o, f)
   where not exists (select 1 from whatsapp_colunas where empresa_id = p_empresa)
$$;
do $$ begin perform app_whatsapp_colunas_padrao(id) from empresas; end $$;

-- Acha (ou cria) o contato e o chamado aberto dele; devolve o chamado
create or replace function app_whatsapp_chamado_do_contato(p_empresa uuid, p_contato uuid, p_usuario uuid) returns uuid
language plpgsql security definer as $$
declare v_ch uuid;
begin
  select id into v_ch from whatsapp_chamados where contato_id = p_contato and aberto order by criado_em desc limit 1;
  if v_ch is null then
    perform app_whatsapp_colunas_padrao(p_empresa);
    insert into whatsapp_chamados (empresa_id, contato_id, coluna_id, ordem, criado_por)
    select p_empresa, p_contato, c.id, coalesce((select min(ordem) from whatsapp_chamados where coluna_id = c.id), 1) - 1, p_usuario
      from whatsapp_colunas c where c.empresa_id = p_empresa and not c.finaliza order by c.ordem limit 1
    returning id into v_ch;
  end if;
  return v_ch;
end $$;

-- Mensagem que chegou pelo webhook (sem usuário logado)
create or replace function app_whatsapp_receber(p_phone_number_id text, p_telefone text, p_nome text, p_texto text,
                                                p_id_externo text, p_quando timestamptz)
returns uuid
language plpgsql security definer as $$
declare v_empresa uuid;
        v_contato uuid;
        v_ch uuid;
begin
  select empresa_id into v_empresa from whatsapp_numeros where phone_number_id = p_phone_number_id and ativo;
  if v_empresa is null then return null; end if;
  if p_id_externo is not null and exists (select 1 from whatsapp_conversa where id_externo = p_id_externo) then return null; end if;
  insert into whatsapp_contatos (empresa_id, telefone, nome) values (v_empresa, p_telefone, nullif(trim(p_nome), ''))
  on conflict (empresa_id, telefone) do update set nome = coalesce(whatsapp_contatos.nome, excluded.nome)
  returning id into v_contato;
  v_ch := app_whatsapp_chamado_do_contato(v_empresa, v_contato, null);
  insert into whatsapp_conversa (empresa_id, contato_id, chamado_id, direcao, texto, status, id_externo, criado_em)
  values (v_empresa, v_contato, v_ch, 'entrada', p_texto, 'recebida', p_id_externo, coalesce(p_quando, now()));
  update whatsapp_contatos set nao_lidas = nao_lidas + 1, ultima_em = coalesce(p_quando, now()) where id = v_contato;
  update whatsapp_chamados set atualizado_em = now() where id = v_ch;
  return v_contato;
end $$;

-- Confirmação de entrega/leitura vinda do webhook
create or replace function app_whatsapp_status(p_id_externo text, p_status text, p_erro text) returns void
language sql security definer as $$
  update whatsapp_conversa set status = p_status, erro = coalesce(p_erro, erro)
   where id_externo = p_id_externo and direcao = 'saida'
     and p_status in ('entregue', 'lida', 'falhou')
     and not (status = 'lida' and p_status = 'entregue')
$$;

-- Pedido de código de "Esqueci a senha". Devolve para onde mandar (nada se não achar ou se pediu há menos de 1 minuto).
create or replace function app_senha_pedir_codigo(p_login text, p_codigo text)
returns table (telefone text, phone_number_id text)
language plpgsql security definer as $$
declare v_u usuarios;
        v_tel text;
begin
  select * into v_u from usuarios where email = lower(trim(coalesce(p_login, ''))) and ativo;
  if v_u.id is null then return; end if;
  v_tel := coalesce(v_u.telefone, (select celular from colaboradores where usuario_id = v_u.id));
  if v_tel is null then return; end if;
  if exists (select 1 from senha_codigos s where s.usuario_id = v_u.id and s.criado_em > now() - interval '1 minute') then return; end if;
  update senha_codigos set usado = true where usuario_id = v_u.id and not usado;
  insert into senha_codigos (usuario_id, codigo_hash, expira_em) values (v_u.id, crypt(p_codigo, gen_salt('bf')), now() + interval '15 minutes');
  return query
    select v_tel, coalesce(
      (select n.phone_number_id from usuario_lojas ul join lojas l on l.id = ul.loja_id
         join whatsapp_numeros n on n.empresa_id = l.empresa_id and n.ativo
        where ul.usuario_id = v_u.id limit 1),
      (select n.phone_number_id from whatsapp_numeros n where n.ativo order by n.atualizado_em limit 1));
end $$;

-- Troca a senha com o código. Até 5 tentativas por código, válido por 15 minutos.
create or replace function app_senha_redefinir(p_login text, p_codigo text, p_senha text) returns boolean
language plpgsql security definer as $$
declare v_u uuid;
        v_s senha_codigos;
begin
  if coalesce(length(p_senha), 0) < 6 then
    raise exception 'A senha precisa ter pelo menos 6 caracteres.' using errcode = '22023';
  end if;
  select id into v_u from usuarios where email = lower(trim(coalesce(p_login, ''))) and ativo;
  if v_u is null then return false; end if;
  select * into v_s from senha_codigos
   where usuario_id = v_u and not usado and expira_em > now() and tentativas < 5
   order by criado_em desc limit 1;
  if v_s.id is null then return false; end if;
  if v_s.codigo_hash <> crypt(coalesce(p_codigo, ''), v_s.codigo_hash) then
    update senha_codigos set tentativas = tentativas + 1 where id = v_s.id;
    return false;
  end if;
  update senha_codigos set usado = true where id = v_s.id;
  update usuarios set senha_hash = crypt(p_senha, gen_salt('bf')), atualizado_em = now() where id = v_u;
  return true;
end $$;

-- Login aceita o usuário em maiúsculas também (o campo da tela não muda nada, mas por garantia)
create or replace function app_login(p_email text, p_senha text)
returns table (id uuid, nome text, email text, admin_rede boolean)
language sql stable security definer as $$
  select u.id, u.nome, u.email, u.admin_rede
    from usuarios u
   where lower(u.email) = lower(trim(p_email))
     and u.ativo
     and u.senha_hash = crypt(p_senha, u.senha_hash)
$$;

-- ------------------------------------------------------------ acesso por grupo
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'whatsapp_contatos') then
    alter table whatsapp_numeros enable row level security;
    alter table whatsapp_contatos enable row level security;
    alter table whatsapp_colunas enable row level security;
    alter table whatsapp_chamados enable row level security;
    alter table whatsapp_conversa enable row level security;
    create policy whatsapp_numeros_grupo on whatsapp_numeros for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
    create policy whatsapp_contatos_grupo on whatsapp_contatos for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
    create policy whatsapp_colunas_grupo on whatsapp_colunas for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
    create policy whatsapp_chamados_grupo on whatsapp_chamados for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
    create policy whatsapp_conversa_grupo on whatsapp_conversa for all using (tem_empresa(empresa_id)) with check (tem_empresa(empresa_id));
  end if;
end $$;

-- (whatsapp_numeros não tem coluna id, então fica fora da auditoria genérica)
drop trigger if exists aud_whatsapp_numeros on whatsapp_numeros;
drop trigger if exists aud_whatsapp_colunas on whatsapp_colunas;
create trigger aud_whatsapp_colunas after insert or update or delete on whatsapp_colunas for each row execute function auditar();

update permissoes set descricao = 'Enviar mensagens e mexer nos chamados' where codigo = 'whatsapp.enviar';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant select, insert, update, delete on whatsapp_numeros, whatsapp_contatos, whatsapp_colunas, whatsapp_chamados, whatsapp_conversa to app_api;
    grant execute on function app_colaborador_acesso(uuid, boolean, text, text, uuid), app_colaborador_ver_acesso(uuid),
      app_whatsapp_colunas_padrao(uuid), app_whatsapp_chamado_do_contato(uuid, uuid, uuid),
      app_whatsapp_receber(text, text, text, text, text, timestamptz), app_whatsapp_status(text, text, text),
      app_senha_pedir_codigo(text, text), app_senha_redefinir(text, text, text), app_login(text, text) to app_api;
  end if;
end $$;
