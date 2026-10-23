-- =====================================================================
-- Dados iniciais para testes no PC
-- Usuário: admin@vistoriaecv.local  ·  senha: admin123  (troque depois)
-- =====================================================================

insert into franquias (id, nome)
values ('10000000-0000-0000-0000-000000000001', 'Rede Vistoria ECV');

insert into empresas (id, franquia_id, razao_social, nome_fantasia)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'VISÃO TOTAL', 'VISÃO TOTAL');

insert into lojas (id, empresa_id, codigo, nome) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '0001', 'Loja 1 · Unidade 1'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '0002', 'Loja 2 · Unidade 2');

insert into perfis (id, empresa_id, nome, descricao)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Administrador', 'Acesso total');
insert into perfil_permissoes (perfil_id, permissao)
select '40000000-0000-0000-0000-000000000001', codigo from permissoes;

insert into usuarios (id, nome, email, senha_hash, admin_rede)
values ('50000000-0000-0000-0000-000000000001', 'Administrador', 'admin@vistoriaecv.local',
        crypt('admin123', gen_salt('bf')), true);

insert into usuario_lojas (usuario_id, loja_id, perfil_id) values
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001');

insert into servicos (empresa_id, nome, descricao) values
  ('20000000-0000-0000-0000-000000000001', 'ECV', 'Vistoria ECV'),
  ('20000000-0000-0000-0000-000000000001', 'CAUTELAR', 'Vistoria cautelar');

insert into categorias_financeiras (empresa_id, tipo, nome) values
  ('20000000-0000-0000-0000-000000000001', 'receber', 'Receitas de Serviços'),
  ('20000000-0000-0000-0000-000000000001', 'pagar', 'Royalties'),
  ('20000000-0000-0000-0000-000000000001', 'pagar', 'Aluguel'),
  ('20000000-0000-0000-0000-000000000001', 'pagar', 'Salários'),
  ('20000000-0000-0000-0000-000000000001', 'pagar', 'Taxas de cartão');

insert into contas_financeiras (loja_id, tipo, nome) values
  ('30000000-0000-0000-0000-000000000001', 'caixa', 'Caixa Loja 1'),
  ('30000000-0000-0000-0000-000000000002', 'caixa', 'Caixa Loja 2');

-- Preços de exemplo (troque pelos da loja)
insert into servico_precos (servico_id, tipo_veiculo, valor)
select s.id, t.tipo::tipo_veiculo, t.valor
  from servicos s
  cross join (values ('carro', 150), ('moto', 120), ('caminhao', 250), ('outro', 150)) t(tipo, valor)
 where s.empresa_id = '20000000-0000-0000-0000-000000000001';

-- Checklist padrão (vale para todos os tipos de veículo). Ajuste os itens
-- conforme o roteiro da franquia.
insert into checklist_modelos (id, empresa_id, nome)
values ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Checklist padrão');

insert into checklist_modelo_itens (modelo_id, grupo, descricao, ordem, exige_foto)
select '60000000-0000-0000-0000-000000000001', grupo, descricao, ordem, foto
  from (values
    ('Identificação', 'Placa e lacre', 1, true),
    ('Identificação', 'Numeração do chassi', 2, true),
    ('Identificação', 'Numeração do motor', 3, true),
    ('Identificação', 'Etiquetas ETA e plaqueta de ano', 4, false),
    ('Identificação', 'Gravação nos vidros', 5, false),
    ('Estrutura', 'Longarinas', 6, false),
    ('Estrutura', 'Colunas', 7, false),
    ('Estrutura', 'Assoalho e caixas de roda', 8, false),
    ('Estrutura', 'Painel corta-fogo e travessas', 9, false),
    ('Lataria e pintura', 'Capô, para-lamas e portas', 10, false),
    ('Lataria e pintura', 'Teto, tampa traseira e para-choques', 11, false),
    ('Itens gerais', 'Pneus e rodas', 12, false),
    ('Itens gerais', 'Faróis e lanternas', 13, false),
    ('Itens gerais', 'Painel e hodômetro', 14, true)
  ) i(grupo, descricao, ordem, foto);
