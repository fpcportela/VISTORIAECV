-- =====================================================================
-- Vendas: liberação de venda finalizada com senha de quem autoriza
-- =====================================================================

-- Reabre uma venda finalizada para edição. Quem é master ou tem
-- "vendas.autorizar" na loja reabre direto; os demais informam o e-mail e a
-- senha de alguém que tenha essa permissão. Fica registrado no histórico.
create or replace function app_reabrir_venda(p_venda uuid, p_email text, p_senha text, p_motivo text)
returns void
language plpgsql security definer as $$
declare v vendas;
        v_autorizador uuid;
begin
  select * into v from vendas where id = p_venda;
  if v.id is null or not tem_loja(v.loja_id) then
    raise exception 'Venda não encontrada.' using errcode = '22023';
  end if;
  if v.situacao <> 'finalizada' then
    raise exception 'Só uma venda finalizada pode ser reaberta.' using errcode = '22023';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da alteração.' using errcode = '22023';
  end if;

  if eh_admin_rede() or pode(v.loja_id, 'vendas.autorizar') then
    v_autorizador := app_usuario_atual();
  else
    select u.id into v_autorizador
      from usuarios u
     where lower(u.email) = lower(trim(coalesce(p_email, ''))) and u.ativo
       and u.senha_hash = crypt(coalesce(p_senha, ''), u.senha_hash)
       and (u.admin_rede or exists (
             select 1 from usuario_lojas ul
               join perfil_permissoes pp on pp.perfil_id = ul.perfil_id
              where ul.usuario_id = u.id and ul.loja_id = v.loja_id and ul.ativo
                and pp.permissao = 'vendas.autorizar'));
    if v_autorizador is null then
      raise exception 'Autorização recusada: e-mail ou senha incorretos, ou sem permissão para liberar.' using errcode = '22023';
    end if;
  end if;

  perform set_config('app.reabrindo_venda', v.id::text, true);
  update vendas set situacao = 'aberta', finalizada_em = null, finalizada_por = null where id = v.id;
  perform set_config('app.reabrindo_venda', '', true);

  insert into venda_historico (venda_id, usuario_id, acao, detalhe, autorizado_por)
  values (v.id, app_usuario_atual(), 'reaberta', trim(p_motivo), v_autorizador);
end $$;
