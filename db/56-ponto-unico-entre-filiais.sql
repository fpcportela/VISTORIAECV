-- =====================================================================
-- Ponto único do colaborador entre as filiais.
-- Quem trabalha em mais de uma unidade (ou em todas) tem UM registro de ponto, que vale
-- em qualquer unidade dele: pode bater a entrada numa filial e a saída em outra. O espelho,
-- o banco de horas, as férias e os atestados contam tudo junto.
-- Antes, as marcações seguiam a unidade em que foram batidas (tem_loja da linha). Com a regra
-- de uma unidade por vez (db/54), quem trocava de unidade no topo deixava de ver as batidas
-- da outra filial: a próxima marcação saía errada (ex.: "entrada" de novo) e o espelho e o
-- banco de horas ficavam pela metade.
-- Agora o acesso às marcações segue o COLABORADOR (como já acontecia com as justificativas,
-- as férias e os atestados). Cada marcação continua guardando a filial em que foi batida
-- (ponto_registros.loja_id), e essa filial precisa ser uma das unidades do colaborador.
-- O colaborador com "Todas as unidades" passa a ficar ligado também às unidades novas do grupo.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- O colaborador trabalha na unidade X? (a principal ou uma das marcadas no cadastro)
create or replace function colaborador_trabalha_em(p_colab uuid, p_loja uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from colaborador_lojas where colaborador_id = p_colab and loja_id = p_loja)
      or exists (select 1 from colaboradores where id = p_colab and loja_id = p_loja)
$$;

-- O colaborador é de uma unidade em que a pessoa está agora (respeita a unidade escolhida no
-- topo). É a mesma regra do cadastro do colaborador, sem olhar as áreas compartilhadas, que
-- só liberam consulta.
create or replace function colaborador_na_unidade(p_colab uuid) returns boolean
language sql stable security definer as $$
  select exists (select 1 from colaboradores c where c.id = p_colab and tem_loja(c.loja_id))
      or exists (select 1 from colaborador_lojas cl where cl.colaborador_id = p_colab and tem_loja(cl.loja_id))
$$;

-- Filial para gravar uma marcação nova do colaborador (inclusão pelo espelho): a unidade
-- escolhida no topo, se ele trabalha nela; senão a principal, se a pessoa está nela; senão
-- a primeira unidade dele em que a pessoa está; por último a principal.
create or replace function loja_ponto_colaborador(p_colab uuid) returns uuid
language sql stable security definer as $$
  select coalesce(
    (select loja_ativa() where loja_ativa() is not null and colaborador_trabalha_em(p_colab, loja_ativa())),
    (select c.loja_id from colaboradores c where c.id = p_colab and tem_loja(c.loja_id)),
    (select cl.loja_id from colaborador_lojas cl join lojas l on l.id = cl.loja_id
      where cl.colaborador_id = p_colab and tem_loja(cl.loja_id) order by l.codigo limit 1),
    (select c.loja_id from colaboradores c where c.id = p_colab))
$$;

-- Marcações: quem vê o colaborador vê todas as batidas dele, de qualquer filial
drop policy if exists ponto_registros_por_loja on ponto_registros;
drop policy if exists ponto_registros_ver on ponto_registros;
drop policy if exists ponto_registros_incluir on ponto_registros;
drop policy if exists ponto_registros_alterar on ponto_registros;
drop policy if exists ponto_registros_excluir on ponto_registros;
create policy ponto_registros_ver on ponto_registros for select
  using (exists (select 1 from colaboradores c where c.id = colaborador_id));
-- gravar: o colaborador é de uma unidade em que a pessoa está, e a filial da batida é dele
create policy ponto_registros_incluir on ponto_registros for insert
  with check (colaborador_na_unidade(colaborador_id) and colaborador_trabalha_em(colaborador_id, loja_id));
create policy ponto_registros_alterar on ponto_registros for update
  using (colaborador_na_unidade(colaborador_id))
  with check (colaborador_na_unidade(colaborador_id) and colaborador_trabalha_em(colaborador_id, loja_id));
create policy ponto_registros_excluir on ponto_registros for delete
  using (colaborador_na_unidade(colaborador_id));

-- Comprovante do dia (um por colaborador e dia): a saída pode ser em outra filial que não a
-- do comprovante anterior, então segue a mesma regra das marcações
drop policy if exists ponto_comprovantes_por_loja on ponto_comprovantes;
drop policy if exists ponto_comprovantes_ver on ponto_comprovantes;
drop policy if exists ponto_comprovantes_incluir on ponto_comprovantes;
drop policy if exists ponto_comprovantes_alterar on ponto_comprovantes;
drop policy if exists ponto_comprovantes_excluir on ponto_comprovantes;
create policy ponto_comprovantes_ver on ponto_comprovantes for select
  using (exists (select 1 from colaboradores c where c.id = colaborador_id));
create policy ponto_comprovantes_incluir on ponto_comprovantes for insert
  with check (colaborador_na_unidade(colaborador_id) and colaborador_trabalha_em(colaborador_id, loja_id));
create policy ponto_comprovantes_alterar on ponto_comprovantes for update
  using (colaborador_na_unidade(colaborador_id))
  with check (colaborador_na_unidade(colaborador_id) and colaborador_trabalha_em(colaborador_id, loja_id));
create policy ponto_comprovantes_excluir on ponto_comprovantes for delete
  using (colaborador_na_unidade(colaborador_id));

-- "Todas as unidades" no colaborador: ligado a todas as unidades ativas do grupo, inclusive
-- as que forem criadas depois (assim ele bate o ponto em qualquer uma). Ao marcar a opção,
-- entram as unidades em que quem salva pode cadastrar colaboradores.
insert into colaborador_lojas (colaborador_id, loja_id)
select c.id, l.id from colaboradores c join lojas l on l.empresa_id = c.empresa_id and l.ativo
 where c.todas_unidades
on conflict do nothing;

create or replace function trg_loja_colaboradores_todas() returns trigger
language plpgsql security definer as $$
begin
  if new.ativo then
    insert into colaborador_lojas (colaborador_id, loja_id)
    select c.id, new.id from colaboradores c where c.empresa_id = new.empresa_id and c.todas_unidades
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists loja_colaboradores_todas on lojas;
create trigger loja_colaboradores_todas after insert or update of ativo on lojas
  for each row execute function trg_loja_colaboradores_todas();

create or replace function trg_colaborador_todas_unidades() returns trigger
language plpgsql security definer as $$
begin
  if new.todas_unidades and (tg_op = 'INSERT' or not old.todas_unidades) then
    insert into colaborador_lojas (colaborador_id, loja_id)
    select new.id, l.id from lojas l
     where l.empresa_id = new.empresa_id and l.ativo
       -- só as unidades em que quem salva pode cadastrar colaboradores (as outras ele não gerencia)
       and (app_usuario_atual() is null or pode_vinculo(l.id, 'colaboradores.editar'))
    on conflict do nothing;
  end if;
  return null;
end $$;
drop trigger if exists colaborador_todas_unidades on colaboradores;
create trigger colaborador_todas_unidades after insert or update of todas_unidades on colaboradores
  for each row execute function trg_colaborador_todas_unidades();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function colaborador_trabalha_em(uuid, uuid), colaborador_na_unidade(uuid),
                              loja_ponto_colaborador(uuid) to app_api;
  end if;
end $$;
