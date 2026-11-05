-- Endereço e horário de funcionamento de cada unidade, editados também nas configurações do robô
-- do WhatsApp (o robô mostra os dois e manda o link do Waze na confirmação). O horário é o mesmo
-- da agenda (agenda_config.horarios), então mudar num lugar muda no outro.

create or replace function app_unidade_endereco_horario(p_loja uuid, p_end jsonb, p_horarios jsonb) returns void
language plpgsql security definer as $$
begin
  if not (eh_admin_rede() or pode(p_loja, 'whatsapp.enviar') or pode(p_loja, 'agenda.gerenciar')) then
    raise exception 'Seu perfil não pode alterar esta unidade.' using errcode = '42501';
  end if;
  if p_end is not null then
    update lojas set cep = nullif(regexp_replace(coalesce(p_end->>'cep', ''), '\D', '', 'g'), ''),
                     logradouro = nullif(upper(trim(p_end->>'logradouro')), ''), numero = nullif(upper(trim(p_end->>'numero')), ''),
                     bairro = nullif(upper(trim(p_end->>'bairro')), ''), cidade = nullif(upper(trim(p_end->>'cidade')), ''),
                     uf = nullif(upper(trim(p_end->>'uf')), '')
     where id = p_loja;
  end if;
  if p_horarios is not null then
    insert into agenda_config (loja_id, horarios) values (p_loja, p_horarios)
    on conflict (loja_id) do update set horarios = excluded.horarios, atualizado_em = now();
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_api') then
    grant execute on function app_unidade_endereco_horario(uuid, jsonb, jsonb) to app_api;
  end if;
end $$;
