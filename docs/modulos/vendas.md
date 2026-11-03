# Módulo: Vendas

## Objetivo

Registrar a venda dos serviços de vistoria: cliente, veículos (placa), itens, desconto, formas de pagamento e a situação da venda (aberta, agendada pelo WhatsApp, finalizada, cancelada). É o centro do sistema: a vistoria em si é feita no sistema do Detran, aqui fica só a venda.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/vendas.js` | Rotas de vendas, edição em lote, troca de unidade, reabrir, confirmar, cancelar, consulta de CNPJ e CEP e a pesquisa geral (`/api/busca`). Também tem as rotas de serviços (ver [servicos](servicos.md)). |
| `api/src/comum.js` | `resolverCliente()`: cliente existente, novo (por CPF/CNPJ) ou "CLIENTE PARTICULAR / AVULSO". |
| `web/src/Vendas.jsx` | `ListaVendas` (filtros, PDF, edição em lote), `EditorVenda` (venda organizada por veículo), janelas `TrocarUnidade`, `AutorizarDesconto`, `LiberarEdicao`, `EdicaoLote`, `RelatorioConsulta`. |
| `web/src/relatorioVendas.js` | `gerarPdfVendas()`: PDF A4 deitado da lista filtrada, com o logo do grupo. |
| `web/src/Inicio.jsx` | Abre cada venda numa aba; as abas ficam montadas para não perder o que foi digitado. |
| `db/01-schema.sql` (seção 5) | `vendas`, `venda_itens`, `venda_historico`, `contadores`, numeração, travas e recálculo do total. |
| `db/02-vendas.sql` | `app_reabrir_venda`. |
| `db/09-venda-pagamentos.sql`, `db/11-venda-cartao-desconto.sql` | `venda_pagamentos` (com CV e bandeira) e `app_autorizar_desconto`. |
| `db/17-venda-futuro.sql` | Situação `futuro`. |
| `db/28-venda-sem-servico.sql` | Item só com a placa e a trava ao finalizar sem serviço. |
| `db/29-autorizar-preco.sql` | `app_autorizar_preco`. |
| `db/36-venda-finalizada-agenda.sql` | Venda finalizada marca o agendamento como "compareceu". |
| `db/38-venda-responsavel-chamado.sql` | Quem salva a venda vira responsável do chamado do WhatsApp. |
| `db/40-venda-trocar-responsavel.sql` | Permissão `vendas.responsavel` e `app_responsaveis_loja` (colaboradores ativos da unidade com usuário ativo). |

## Funções e rotas públicas

### API

| Rota | O que faz |
| --- | --- |
| `GET /api/vendas` | Lista até 1000 vendas. Filtros: `loja`, `situacao`, `tipo`, `periodo` (`hoje`/`mes`), `busca` (nome, número, CPF/CNPJ ou placa), `cliente`, `de`, `ate`. Traz placas, veículos e `sem_servico`. |
| `GET /api/vendas/:id` | Venda com loja, cliente, itens (com a consulta de placa do veículo), histórico, pagamentos, o que o usuário pode fazer e os agendamentos ligados. |
| `POST /api/vendas`, `PUT /api/vendas/:id` | Grava a venda (`gravarVenda`). Só altera venda `aberta` ou `futuro`. |
| `POST /api/vendas/autorizar-preco` | Confere a senha de quem autoriza antes de destravar os preços na tela. |
| `POST /api/vendas/:id/finalizar` | Exige `vendas.finalizar` e pagamentos iguais ao total. |
| `POST /api/vendas/:id/confirmar` | `futuro` → `aberta`. |
| `POST /api/vendas/:id/cancelar` | Exige motivo e `vendas.cancelar`; só para venda aberta/futuro. |
| `POST /api/vendas/:id/reabrir` | Chama `app_reabrir_venda` (finalizada → aberta) com motivo. |
| `POST /api/vendas/:id/unidade` | Troca a unidade (centro de custo) de uma venda aberta, para outra do mesmo grupo, com senha de quem tem `vendas.autorizar`. |
| `POST /api/vendas/lote` | Muda responsável, data do serviço e/ou unidade de até 500 vendas abertas; devolve as alteradas e as puladas com o motivo. |
| `GET /api/vendas-responsaveis?loja=` | Usuários que podem ser responsáveis no grupo (`app_responsaveis`), usado na edição em lote. |
| `GET /api/vendas/responsaveis?loja=` | Colaboradores ativos da unidade (com usuário ativo) para trocar o responsável de uma venda (`app_responsaveis_loja`). Exige `vendas.responsavel`. |
| `GET /api/cnpj/:cnpj`, `GET /api/cep/:cep` | Dados públicos do CNPJ (BrasilAPI) e endereço pelo CEP (ver [clientes](clientes.md)). |
| `GET /api/busca?q=&loja=` | Pesquisa do topo: até 8 clientes, 8 vistorias e 8 vendas; devolve `placa` se o texto for uma placa válida. |

### Funções internas (`vendas.js`)

| Função | O que faz |
| --- | --- |
| `gravarVenda(db, req, existente)` | Valida desconto (com autorização), itens, placas, pagamentos e preços; resolve o cliente; apaga e grava de novo itens e pagamentos; registra o histórico; liga o agendamento; chama `app_venda_responsavel_chamado`. |
| `buscarVenda(db, id)` | Lê a venda e exige `vendas.ver` na loja dela. |
| `empresaDaLoja(db, loja)` | Grupo da loja (403 se a pessoa não vê a loja). |
| `dinheiro(v)`, `dataValida(v)` | Conversão de valores e datas. |

### Banco

| Função / gatilho | O que faz |
| --- | --- |
| `proximo_numero(empresa, tipo)`, `numerar_por_grupo()` (gatilho `trg_vendas_numero`) | Número da venda por grupo (a primeira é a nº 1); também preenche `empresa_id` pela loja. |
| `vendas_recalcular()` (gatilho em `venda_itens`) | Recalcula `valor_bruto`. `valor_total` é coluna gerada (`valor_bruto - desconto`). |
| `vendas_travar()` | Bloqueia alterar ou apagar venda finalizada ou cancelada, a não ser durante `app_reabrir_venda`. |
| `venda_itens_travar()` | Bloqueia mexer nos itens se a venda não estiver `aberta` ou `futuro`. |
| `vendas_exigir_servico()` | Não deixa finalizar com item sem serviço ou sem nenhum serviço. |
| `app_reabrir_venda(venda, email, senha, motivo)` | Master ou quem tem `vendas.autorizar` reabre direto; os demais informam e-mail e senha de quem autoriza. |
| `app_autorizar_desconto`, `app_autorizar_preco` | Conferem e-mail e senha de quem tem `vendas.desconto` na loja (ou master). |
| `app_venda_agenda_compareceu`, gatilho `trg_venda_agenda_compareceu` | Ao finalizar, liga a venda a um agendamento da mesma unidade (mesmo dia ou dia anterior, mesma placa ou mesmo cliente) e o marca como `compareceu`. |
| `app_venda_responsavel_chamado(venda, usuario)` | Põe quem salvou (ou o responsável escolhido) como responsável do chamado do WhatsApp da venda ou do agendamento dela. |
| `app_responsaveis_loja(loja)` | Colaboradores ativos da unidade (principal ou extra) ligados a um usuário ativo. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md), [servicos](servicos.md), [clientes](clientes.md) (`resolverCliente`, preços especiais), [consulta-placa-e-fipe](consulta-placa-e-fipe.md) (`normalizarPlaca`, veículo e relatório da consulta), [agenda](agenda.md) (agendamentos), [whatsapp-e-robo](whatsapp-e-robo.md) (chamados).
- **Quem depende dele:** [inicio](inicio.md) (contadores e vendas em aberto), [relatorios](relatorios.md) (relatório de vendas e faturamento em conta a receber), [financeiro](financeiro.md) (`lancamento_vendas`), [agenda](agenda.md) (venda aberta a partir de um agendamento), [whatsapp-e-robo](whatsapp-e-robo.md) (o robô abre venda `futuro` com `app_robo_abrir_venda`), royalties no banco (`calcular_royalty` lê as vendas finalizadas).

## Tabelas usadas

`vendas`, `venda_itens`, `venda_pagamentos`, `venda_historico`, `contadores`, `veiculos`, `clientes`, `cliente_precos`, `servicos`, `servico_precos`, `categorias_financeiras` (categoria de receita da venda), `agendamentos`, `whatsapp_chamados`, `auditoria` (gatilhos `aud_vendas`, `aud_venda_itens`, `aud_venda_pagamentos`).

## Regras de negócio e casos especiais

- **Situações:** `aberta` (amarela quando falta serviço), `futuro` (mostrada como "Agendado"; aberta pelo robô do WhatsApp), `finalizada` (travada), `cancelada`. O tipo é sempre `venda_avulsa`; `orcamento` existe no banco mas não é usado.
- **Numeração:** uma sequência por grupo, compartilhada pelas lojas do grupo (`contadores`).
- **Venda por veículo:** cada veículo tem placa, tipo, marca, modelo e os seus itens. Um veículo sem serviço vira uma linha só com a placa (`servico_id` nulo, valor zero) para a placa não se perder. A descrição do item é "MARCA MODELO // PLACA".
- **Preço travado:** o preço do item vem do preço especial do cliente (ou do grupo de clientes dele), senão do preço por tipo de veículo, senão do valor padrão. Valor diferente, que não seja o já salvo na venda, exige e-mail e senha de quem tem `vendas.desconto`. A alteração fica no histórico (`acao = 'preco'`).
- **Desconto:** desconto novo ou alterado exige a senha de quem tem `vendas.desconto`. Sem ela a API responde **428**, e a tela abre a janela de autorização. O desconto não pode passar do total dos itens.
- **Pagamentos:** várias linhas (data, forma, valor, detalhe; CV e bandeira só para cartão). Enquanto aberta, a soma pode ser menor que o total, mas não maior. Para finalizar, a soma precisa ser igual ao total (tolerância de R$ 0,005).
- **Cliente:** existente do grupo, novo pelo CPF/CNPJ (se já existir no grupo, usa o mesmo) ou o cliente "CLIENTE PARTICULAR / AVULSO" do grupo (criado na primeira vez).
- **Reabrir:** só venda finalizada, com motivo; fica no histórico com quem autorizou.
- **Agenda:** venda aberta a partir de um agendamento já liga os dois e marca "compareceu". Venda já ligada a um agendamento de hoje ou de antes, ao ser salva, também marca "compareceu". Finalizar procura um agendamento compatível (ver `app_venda_agenda_compareceu`).
- **Data:** sem data informada, vale o dia de hoje em São Paulo.
- **Responsável da venda:** por padrão é quem criou a venda. Com `vendas.responsavel`, a tela deixa escolher outro entre os colaboradores ativos da unidade; a troca fica no histórico (`acao = 'responsavel'`) e esse responsável passa a ser também o do chamado do WhatsApp. A permissão foi ligada nos perfis que já tinham `vendas.autorizar` (`db/40`).
- **Edição em lote:** pula vendas sem permissão, não abertas, de outro grupo, ou com responsável que não trabalha no grupo.

## Pontos frágeis, TODOs e dívidas técnicas

- Duas listas de responsáveis com regras diferentes: `/api/vendas-responsaveis` (`app_responsaveis`, usuários do grupo, edição em lote) e `/api/vendas/responsaveis` (`app_responsaveis_loja`, colaboradores ativos da unidade com login, venda única).
- **Finalizar não gera conta a receber.** A venda só entra no Financeiro quando é "faturada" pelo relatório (ver [relatorios](relatorios.md)).
- `gravarVenda` apaga e insere de novo todos os itens e pagamentos a cada salvamento. Os ids mudam e a auditoria registra tudo como exclusão + inclusão.
- O PUT não troca a loja da venda (`existente.loja_id`); para isso existe a rota `/unidade` ou a edição em lote.
- Na tela, depois de destravar os preços, o e-mail e a senha de quem autorizou ficam guardados no estado do React até salvar (`precoLiberado`) e são mandados de novo no salvamento.
- `relatorioVendas.js` tem o próprio mapa `SITUACOES` sem `futuro`. Uma venda agendada sai no PDF com a coluna de situação vazia (`SITUACOES[v.situacao]` dá `undefined`).
- Os campos `nfse_numero` e `nfse_status` existem em `vendas`, mas nenhum código os usa.
- `tipo_venda 'orcamento'` está no banco e na lista de filtros da API, mas a gravação força `venda_avulsa`.
- A lista de vendas tem limite fixo de 1000 linhas, sem paginação.
- No código atual, a situação `futuro` só é gravada pelo robô (`app_robo_abrir_venda`, `db/18`). Por isso o cartão "agendadas pelo WhatsApp" do início conta todas as vendas `futuro`.
