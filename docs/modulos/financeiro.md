# Módulo: Financeiro

## Objetivo

Contas a receber e a pagar de cada loja, com parcelas, pagamento parcial (baixa), plano de contas (grupos e categorias de receitas e despesas), centros de custo, contas de caixa e banco com saldo, e documentos anexados aos lançamentos.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/financeiro.js` | Todas as rotas `/api/financeiro/...`. |
| `web/src/Financeiro.jsx` | Tela com abas: a receber, a pagar, plano de contas, centros de custo, contas (caixa/banco). Componentes `Lancamentos`, `EditorLancamento`, `Baixa`, `PlanoContas`, `CentrosCusto`, `Documentos`, `ContasFinanceiras`. |
| `db/01-schema.sql` (seção 7) | `contas_financeiras`, `lancamentos`, `lancamento_baixas`, gatilho `lancamentos_atualizar_pago`, view `resumo_contas`. |
| `db/08-financeiro.sql` | Plano de contas (colunas `grupo`, `codigo`), `centros_custo`, `lancamentos.centro_custo_id`, permissão `financeiro.plano`. |
| `db/16-relatorios-faturamento.sql` | `lancamento_vendas` (vendas faturadas numa conta a receber) e o gatilho que as libera ao cancelar. |
| `db/21-financeiro-anexos-contas.sql` | `lancamento_arquivos`; competência sempre no 1º dia do mês. |

## Funções e rotas públicas

| Rota | O que faz |
| --- | --- |
| `GET /api/financeiro/plano?loja=` | Categorias e grupos do grupo da loja, com o número de lançamentos de cada uma. |
| `POST/PUT /api/financeiro/categorias` | Cria grupo (precisa do tipo receita/despesa) ou categoria (precisa do grupo pai; herda o tipo). Na edição muda nome, código e ativo. Exige `financeiro.plano` em alguma loja do grupo (ou master). |
| `GET /api/financeiro/centros`, `POST/PUT /api/financeiro/centros` | Centros de custo do grupo; nome único por grupo. Exige `financeiro.plano`. |
| `GET /api/financeiro/contas?loja=` | Contas ativas da loja (sem as de adquirente). Se a loja não tiver nenhuma e a pessoa puder lançar, **cria o "Caixa <loja>"** na hora. |
| `GET /api/financeiro/contas/todas?loja=` | Contas de todas as lojas do grupo com o saldo: saldo inicial + recebido − pago (com juros e multa, menos desconto) desde a data do saldo inicial. |
| `POST/PUT /api/financeiro/contas` | Caixa, conta corrente ou poupança; banco, agência, conta, saldo inicial e data. Exige `financeiro.lancar`. |
| `GET /api/financeiro/lancamentos` | Até 2000 lançamentos. Filtros: `tipo`, `loja`, `situacao` (`aberto`, `vencido`, `pago`, `cancelado`), `categoria` (ou grupo), `centro`, `de`/`ate` (vencimento), `busca` (descrição ou documento). |
| `GET /api/financeiro/lancamentos/:id` | Lançamento com baixas, permissões e documentos. |
| `POST /api/financeiro/lancamentos` | Cria 1 a 60 parcelas mensais; a última leva a diferença de centavos; parcelas ligadas por `grupo_parcelas`. |
| `PUT /api/financeiro/lancamentos/:id` | Altera; o valor não pode ficar menor que o já pago; recalcula o status. |
| `POST /api/financeiro/lancamentos/:id/baixar` | Registra pagamento/recebimento (data, valor, forma, conta, juros, multa, desconto). O valor não pode passar do saldo em aberto. |
| `DELETE /api/financeiro/lancamentos/:id/baixas/:baixa` | Desfaz um pagamento. Exige `financeiro.excluir`. |
| `POST /api/financeiro/lancamentos/:id/cancelar` | Cancela se não houver pagamento. |
| `DELETE /api/financeiro/lancamentos/:id` | Exclui se não houver pagamento. Exige `financeiro.excluir` (também há uma política RLS restritiva para `delete`). |
| `POST /api/financeiro/lancamentos/:id/arquivos?arquivo=&nome=&mime=` | Anexa um arquivo (corpo bruto, até 15 MB) guardado no banco (`bytea`). |
| `GET/PUT/DELETE /api/financeiro/arquivos/:id` | Abre ou baixa (`?baixar=1`), renomeia, exclui. |

Funções internas: `campos()` (valida descrição, vencimento, competência, categoria do tipo certo e centro de custo), `somarMeses()` (31/01 + 1 mês = 28/02), `exigirPlano()`, `lancamento()`, `empresaDaLoja()`, `dinheiro()`, `dataValida()`.

Banco: `lancamentos_atualizar_pago()` (gatilho em `lancamento_baixas`: soma as baixas em `valor_pago`, define `pago_em` e o status), view `resumo_contas` (vencidos, vencem hoje e restante do mês por loja e tipo, usada no [inicio](inicio.md)), `liberar_vendas_faturadas()` (gatilho: cancelar a conta a receber libera as vendas para faturar de novo).

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md), [grupos-e-unidades](grupos-e-unidades.md) (`app_preparar_grupo` cria o plano de contas e os centros de custo).
- **Quem depende dele:** [inicio](inicio.md) (cartões A receber / A pagar), [relatorios](relatorios.md) (relatório financeiro e faturamento de vendas em conta a receber), [vendas](vendas.md) (categoria de receita da venda).

## Tabelas usadas

`lancamentos`, `lancamento_baixas`, `lancamento_arquivos`, `lancamento_vendas`, `categorias_financeiras`, `centros_custo`, `contas_financeiras`, `lojas`. Auditoria em `lancamentos`, `lancamento_baixas`, `centros_custo`, `categorias_financeiras`.

## Regras de negócio e casos especiais

- Cada parcela é um lançamento.
- Todo lançamento precisa de uma **categoria** (não um grupo) do mesmo tipo: receita para "a receber", despesa para "a pagar".
- A **competência** é só mês/ano: é gravada no primeiro dia do mês. Sem competência informada, vale o mês do vencimento.
- Status: `em_aberto` → `pago_parcial` → `pago` pelas baixas (gatilho). `cancelado` só sem pagamento.
- "Vencido" é calculado: em aberto ou parcial com vencimento antes de hoje (São Paulo).
- Para receber ou pagar é obrigatório escolher a conta (caixa ou banco) da mesma loja.
- Centro de custo: por padrão um por loja (criado por `app_preparar_grupo`); dá para criar outros.

## Pontos frágeis, TODOs e dívidas técnicas

- **Desconto na baixa não abate o saldo.** O gatilho soma só `valor` das baixas em `valor_pago`; juros, multa e desconto entram apenas no saldo da conta. Pagar R$ 90 com R$ 10 de desconto numa conta de R$ 100 deixa o lançamento "pago em parte".
- `GET /api/financeiro/contas` grava no banco (cria o caixa) numa leitura.
- Uma venda finalizada não vira conta a receber sozinha; só pelo faturamento em [relatorios](relatorios.md).
- As tabelas de integração (`maquininhas`, `maquininha_taxas`, `transacoes_cartao`, `extrato_bancario`, `importacoes_arquivo`) e as permissões `financeiro.conciliar`, `financeiro.importar`, `maquininhas.ver`, `integracoes.gerenciar` existem, mas não há rota nem tela. No início, "Contas e maquininhas" mostra "Nenhum banco ou maquininha conectado" e o botão "Conectar" só mostra "será desenvolvido".
- `lancamentos.fornecedor_id`, `venda_id` e `apuracao_royalty_id` existem, mas a API não grava esses campos (a lista só lê `venda_id`). `cliente_id` só é gravado pelo faturamento em [relatorios](relatorios.md); as rotas do financeiro não deixam escolher o cliente. A tabela `fornecedores` não tem tela.
- Os anexos ficam dentro do banco (`bytea`), o que aumenta o tamanho dos backups.
- Limite fixo de 2000 lançamentos na lista, sem paginação.
- `dinheiro()` e `dataValida()` estão copiados em `vendas.js` e `financeiro.js` com pequenas diferenças (a de `financeiro.js` aceita valor negativo e confere a data com `Date.parse`).
