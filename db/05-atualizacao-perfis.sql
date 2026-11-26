-- =====================================================================
-- Perfis com "Consulta" e "Uso" por módulo, e usuário com CPF e celular.
-- Pode rodar de novo sem problema (npm run banco:atualizar).
-- =====================================================================

-- Cada permissão é de consulta (só ver) ou de uso (fazer algo no módulo)
alter table permissoes add column if not exists nivel text not null default 'uso'
  check (nivel in ('consulta', 'uso'));

-- Módulos que só tinham permissão de uso ganham a de consulta
insert into permissoes (codigo, modulo, descricao) values
  ('servicos.ver',  'Serviços e produtos',   'Ver serviços, produtos e preços'),
  ('lojas.ver',     'Lojas',                 'Ver as lojas'),
  ('usuarios.ver',  'Usuários e permissões', 'Ver usuários e perfis'),
  ('whatsapp.ver',  'WhatsApp',              'Ver as conversas'),
  ('config.ver',    'Configurações',         'Ver as configurações')
on conflict (codigo) do nothing;

update permissoes set nivel = 'consulta'
 where codigo in ('vistorias.ver', 'clientes.ver', 'vendas.ver', 'servicos.ver', 'financeiro.ver', 'royalties.ver',
                  'maquininhas.ver', 'lojas.ver', 'usuarios.ver', 'ponto.ver_equipe', 'relatorios.ver',
                  'whatsapp.ver', 'config.ver');
update permissoes set descricao = 'Ver as vendas' where codigo = 'vendas.ver';
update permissoes set descricao = 'Criar e alterar vendas' where codigo = 'vendas.criar';

-- Quem já gerenciava estes módulos continua vendo esses módulos
insert into perfil_permissoes (perfil_id, permissao)
select pp.perfil_id, n.ver
  from perfil_permissoes pp
  join (values ('servicos.gerenciar', 'servicos.ver'), ('lojas.gerenciar', 'lojas.ver'),
               ('usuarios.gerenciar', 'usuarios.ver'), ('whatsapp.enviar', 'whatsapp.ver'),
               ('config.gerenciar', 'config.ver')) n(uso, ver) on n.uso = pp.permissao
on conflict do nothing;

-- Leitura de placa por foto saiu do sistema (não será usada)
delete from perfil_permissoes where permissao = 'placa.foto';
delete from permissoes where codigo = 'placa.foto';
