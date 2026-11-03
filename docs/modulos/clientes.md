# Módulo: Clientes

## Objetivo

Cadastro dos clientes de cada grupo: pessoa física, empresa (PJ) e **grupo de clientes** (reúne várias empresas/CNPJs), sempre identificados por CPF ou CNPJ e sem duplicar. Inclui a tabela de **preços especiais** por cliente e por serviço, a validação de CPF/CNPJ e a busca de dados públicos de CNPJ e de endereço pelo CEP.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/clientes.js` | Rotas `/api/clientes` (lista, detalhe, preços, criar, alterar). |
| `api/src/documentos.js` | `cpfValido`, `cnpjValido`, `consultarCnpj` (BrasilAPI → Minha Receita → CNPJ.ws) e `consultarCep` (ViaCEP → BrasilAPI). |
| `api/src/comum.js` | `resolverCliente()`: usado pela venda para achar ou criar o cliente. |
| `api/src/vendas.js` | Rotas `GET /api/cnpj/:cnpj` e `GET /api/cep/:cep`. |
| `web/src/Clientes.jsx` | Tela "Clientes" e o `EditorCliente` (também aberto por Vendas, Agenda e WhatsApp). |
| `web/src/documentos.js` | Máscaras e validação de CPF, CNPJ e telefone no navegador (mesma regra do servidor). |
| `db/01-schema.sql` (seção 4) | Tabela `clientes` e o índice único `clientes_doc (empresa_id, cpf_cnpj)`. |
| `db/12-clientes.sql` | Tipo `grupo`, `nome_fantasia`, `grupo_cliente_id`. |
| `db/26-precos-cliente.sql` | Tabela `cliente_precos`; remove comissão e parceiros (testados e deixados de lado). |

## Funções e rotas públicas

| Função / rota | O que faz |
| --- | --- |
| `GET /api/clientes` | Até 300 clientes. Filtros: `loja` (grupo da loja), `tipo` (`pf`, `pj`, `grupo`), `busca` (nome, fantasia, nome do grupo, CPF/CNPJ ou telefone), `venda=1` (tira os grupos), `inativos=1`. |
| `GET /api/clientes/:id` | Cliente com as empresas (se for grupo), resumo de vendas (quantidade, total, última; inclui as empresas do grupo), preços especiais e se a pessoa pode editar. |
| `GET /api/clientes/:id/precos` | Preços que valem na venda: os do cliente e, onde não houver, os do grupo de clientes dele. |
| `POST /api/clientes`, `PUT /api/clientes/:id` | Valida tipo, nome, CPF (pf) ou CNPJ (pj); grupo não tem documento. Só PJ pode estar num grupo de clientes, e o grupo precisa ser do mesmo grupo do sistema. Grava os preços especiais (`gravarPrecos`). |
| `gravarPrecos(db, cliente, lista)` (interna) | Apaga e grava de novo os preços especiais (até 500), só para serviços do mesmo grupo. |
| `podeNaEmpresa(db, empresa, permissao)` (interna) | A pessoa tem a permissão em alguma loja do grupo? |
| `resolverCliente(db, {...})` (`comum.js`) | Cliente existente do grupo; ou novo por CPF/CNPJ (se já existe no grupo, reaproveita; exige `clientes.editar` para criar); ou o "CLIENTE PARTICULAR / AVULSO" do grupo. |
| `consultarCnpj(cnpj)` | Tenta três fontes públicas em ordem; devolve razão social, fantasia, situação, telefone, e-mail, CEP, endereço, cidade e UF; 404 se nenhuma achou, 502 se todas falharam. |
| `consultarCep(cep)` | ViaCEP e, se falhar, BrasilAPI. |
| `EditorCliente` (front) | Ao digitar um documento já cadastrado, abre o cliente existente; com CNPJ, preenche pela Receita; com CEP, preenche o endereço. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md), [servicos](servicos.md) (lista para os preços especiais), serviços externos públicos (BrasilAPI, Minha Receita, CNPJ.ws, ViaCEP).
- **Quem depende dele:** [vendas](vendas.md) (cliente e preço travado), [agenda](agenda.md) e [whatsapp-e-robo](whatsapp-e-robo.md) (abrem o `EditorCliente`; o robô reconhece o cliente pelo telefone e cria clientes), [grupos-e-unidades](grupos-e-unidades.md) e [acesso-e-usuarios](acesso-e-usuarios.md) (usam `cnpjValido`/`cpfValido`).

## Tabelas usadas

`clientes`, `cliente_precos`, `servicos`, `vendas` (resumo), `lojas`. Auditoria em `clientes` (`aud_clientes`).

## Regras de negócio e casos especiais

- **Sem duplicidade:** índice único por grupo e documento (`empresa_id, cpf_cnpj`). A mesma pessoa pode existir em dois grupos diferentes do sistema.
- Tipos: `pf` (CPF), `pj` (CNPJ, nome fantasia, pode pertencer a um grupo de clientes), `grupo` (sem documento) e `avulso` (o "CLIENTE PARTICULAR / AVULSO", um por grupo, criado automaticamente, que não pode ser alterado e não aparece na tela de clientes).
- A venda é sempre para uma pessoa ou empresa, nunca para o grupo de clientes (`venda=1` tira os grupos da busca).
- Um grupo de clientes com empresas não pode mudar de tipo.
- Preço especial: o do cliente vale mais que o do grupo de clientes dele, que vale mais que a tabela do serviço.
- Texto gravado em maiúsculas (nome, endereço, cidade); e-mail em minúsculas; documento e telefones só com números.
- O site da Receita tem captcha, por isso a consulta usa fontes públicas que replicam os dados (comentário em `documentos.js`).

## Pontos frágeis, TODOs e dívidas técnicas

- As colunas `consulta_serasa` e `serasa_consultado_em` existem, mas nenhum código consulta o Serasa (a API remove `consulta_serasa` do retorno da venda).
- A validação de CPF/CNPJ está duplicada em `api/src/documentos.js` e `web/src/documentos.js`.
- `gravarPrecos` apaga e insere de novo todos os preços a cada salvamento; a tabela `cliente_precos` não tem auditoria.
- Lista limitada a 300 clientes, sem paginação.
- Não existe exclusão de cliente, só `ativo = false`.
- O cliente avulso é achado pelo nome fixo "CLIENTE PARTICULAR / AVULSO"; mudar esse texto no banco faz o sistema criar outro.
