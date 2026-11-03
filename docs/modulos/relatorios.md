# Módulo: Relatórios e faturamento

## Objetivo

- **Relatório personalizado:** a pessoa escolhe a fonte (vendas ou contas a pagar/receber), os filtros, as colunas e o agrupamento, vê na tela com subtotais e gera o PDF. As escolhas podem ser salvas como modelo.
- **Faturar cliente:** juntar vendas de um cliente (ou das empresas de um grupo de clientes) que ainda não foram pagas numa **conta a receber** em aberto, que é a previsão de recebimento no financeiro.
- Também ficam aqui os geradores de PDF usados por outras telas: lista de vendas (`relatorioVendas.js`) e relatório do ponto (`relatorioPonto.js`).

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/relatorios.js` | Rotas `/api/relatorios/vendas`, `/financeiro`, `/modelos`, `/faturar`. |
| `web/src/Relatorios.jsx` | Tela com as abas "Relatório personalizado" (`Personalizado`, `GrupoLinhas`) e "Faturar cliente" (`Faturar`, `GerarRecebimento`); `CampoCliente` (busca de cliente, também exportado). Definição das colunas (`COLUNAS`), colunas padrão (`PADRAO`) e agrupamentos (`GRUPOS`). |
| `web/src/relatorioPersonalizado.js` | `gerarPdfRelatorio`: PDF A4 deitado com logo do grupo, filtros, colunas, grupos com subtotal e total geral, na cor do tema. |
| `web/src/relatorioVendas.js` | `gerarPdfVendas`: PDF da lista de vendas filtrada (usado em `Vendas.jsx`). |
| `web/src/relatorioPonto.js` | `gerarPdfPonto`: PDF do ponto do mês (usado em `Ponto.jsx`). |
| `db/16-relatorios-faturamento.sql` | `relatorio_modelos` (por usuário), `lancamento_vendas` (venda faturada uma vez só), gatilho `liberar_vendas_faturadas`. |

## Funções e rotas públicas

| Rota | O que faz |
| --- | --- |
| `GET /api/relatorios/vendas` | Uma linha por venda, até 5000. Filtros: `loja`, `cliente` (o cliente ou todas as empresas do grupo de clientes), `de`/`ate` (data da venda), `situacao`, `vendedor`, `faturar=1` (só as que ainda têm valor a faturar). Traz placas, veículos, serviços, formas de pagamento, valor "a faturar" e a conta em que foi faturada. Exige `relatorios.ver` na loja da venda. |
| `GET /api/relatorios/financeiro` | Lançamentos, até 5000. Filtros: `tipo`, `loja`, `cliente`, `situacao` (`aberto`, `vencido`, `pago`, `cancelado`), período por `data` = vencimento, competência ou pagamento. Exige `relatorios.ver` **e** `financeiro.ver`. |
| `GET/POST/DELETE /api/relatorios/modelos` | Modelos do próprio usuário (nome em maiúsculas, único por usuário; salvar com o mesmo nome substitui; configuração até 5000 caracteres). |
| `POST /api/relatorios/faturar` | Recebe até 1000 vendas, data prevista, categoria de receita, descrição e documento. Cria **uma conta a receber por loja** (centro de custo da loja), liga cada venda em `lancamento_vendas` e registra no histórico da venda. Exige `financeiro.lancar` em cada loja. |

Expressão `A_FATURAR`: total da venda menos o que já foi pago em formas diferentes de `faturado` (nunca negativo).

## Dependências

- **Depende de:** [vendas](vendas.md), [financeiro](financeiro.md) (lançamentos, categorias, centros de custo), [clientes](clientes.md) (grupo de clientes), [acesso-e-usuarios](acesso-e-usuarios.md), [grupos-e-unidades](grupos-e-unidades.md) (logo e nome no PDF), [interface-comum](interface-comum.md) (`CampoData`, `semAcento`).
- **Quem depende dele:** [financeiro](financeiro.md) (a conta faturada aparece no financeiro; cancelar libera as vendas), [vendas](vendas.md) (PDF da lista), [colaboradores-e-ponto](colaboradores-e-ponto.md) (PDF do ponto).

## Tabelas usadas

`vendas`, `venda_itens`, `venda_pagamentos`, `venda_historico`, `veiculos`, `servicos`, `clientes`, `usuarios`, `lojas`, `lancamentos`, `lancamento_vendas`, `categorias_financeiras`, `centros_custo`, `relatorio_modelos`.

## Regras de negócio e casos especiais

- Uma venda só pode ser faturada **uma vez** (índice único em `lancamento_vendas.venda_id`). Se duas pessoas faturarem ao mesmo tempo, a segunda recebe "Alguma venda já foi faturada agora há pouco".
- Não entram no faturamento: vendas canceladas, vendas `futuro` (agendadas), já faturadas ou sem valor a receber.
- Todas as vendas precisam ser do mesmo grupo do sistema e de **um cliente só** ou de empresas do mesmo grupo de clientes. Com várias empresas do grupo, a conta fica no nome do grupo de clientes.
- A conta nasce em aberto, com competência = hoje, descrição padrão "FATURA <cliente>" e observação "Vendas nº …".
- Cancelar a conta a receber apaga as ligações em `lancamento_vendas` (gatilho `liberar_vendas_faturadas`) e as vendas voltam a poder ser faturadas.
- A aba "Faturar cliente" só aparece para quem tem `financeiro.lancar` em alguma loja. Quando não há nada a faturar, a tela mostra as vendas do cliente para explicar por que ficaram de fora.
- Agrupamentos: vendas por cliente, loja, responsável, dia, mês, situação ou pagamento; financeiro por categoria, centro de custo, loja, cliente, mês do vencimento, situação ou tipo.
- O PDF é gerado no navegador; as bibliotecas (jspdf, jspdf-autotable) só carregam quando o botão é usado.

## Pontos frágeis, TODOs e dívidas técnicas

- Limite fixo de 5000 linhas por relatório; o código da tela não tem aviso de resultado cortado.
- O faturamento não muda a situação da venda nem lança pagamento nela; só liga a venda à conta. Receber a conta no financeiro não marca a venda como paga.
- `relatorioVendas.js` não tem a situação `futuro` no seu mapa de nomes (`SITUACOES`), então essas vendas saem com a situação em branco no PDF da lista de vendas.
- `dataValida` é mais uma cópia (também em `vendas.js`, `financeiro.js`, `pessoas.js`).
- `A_FATURAR` é um trecho de SQL montado por texto e repetido em duas consultas.
