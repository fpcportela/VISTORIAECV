# Módulo: Agenda

## Objetivo

Agenda de vistorias por loja: horário de atendimento, almoço, duração e vagas simultâneas, bloqueios (feriado, folga), agendamentos feitos na tela ou pelo robô do WhatsApp, confirmação pelo WhatsApp (o cliente responde SIM ou NÃO e pode remarcar pela conversa) e o histórico de remarcações. A situação do agendamento move o chamado do WhatsApp no quadro e é atualizada quando a venda é feita.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/agenda.js` | Rotas `/api/agenda...`, envio da confirmação e do "confirmado" pelo WhatsApp, ligação com o chamado. |
| `api/src/agendaTexto.js` | Textos: `rotuloHorario`, `enderecoLoja`, `linkWaze`, `textoHorarios`, `encurtar` (is.gd / tinyurl), `textoConfirmacao`, `textoConfirmado`. |
| `api/src/confirmacaoAgenda.js` | `responderConfirmacao`: trata a resposta do cliente (SIM, NÃO, dia, hora) antes do robô. `lerDia`, `lerHora`. |
| `web/src/Agenda.jsx` | Tela: dia, semana ou mês; `Cartao` do agendamento; `Editor` (novo/editar, com a janela "Chamado no WhatsApp"); `Configurar` (horários e bloqueios). |
| `db/23-agenda.sql` | `agenda_config`, `agenda_bloqueios`, `agendamentos`, `agenda_livres`, funções do robô, `chamado_liga_agendamento`, permissões `agenda.ver`/`agenda.gerenciar`. |
| `db/30-unidades-robo.sql` | Versões por unidade das funções do robô (`app_agenda_livres_unidade`, `app_agenda_unidade_robo`). |
| `db/32-confirmacao-agenda.sql` | Colunas `confirmacao_etapa`/`confirmacao_dados`, `agenda_historico`, `tel_chave`, funções da confirmação. |
| `db/33-unidades-endereco-horario.sql` | `app_unidade_endereco_horario` (horário da agenda editado pela tela do robô). |
| `db/36-venda-finalizada-agenda.sql` | Venda finalizada → agendamento "compareceu" → chamado concluído. |
| `db/37-agenda-colunas-chamado.sql` | Situação do agendamento move o chamado para as colunas CONFIRMAR / AGENDADO. |

## Funções e rotas públicas

### API

| Rota | O que faz |
| --- | --- |
| `GET /api/agenda?loja=&de=&ate=` | Configuração, agendamentos (com serviço, venda, cliente e responsável), bloqueios, horários livres, histórico, serviços do grupo, colunas do quadro do WhatsApp e se a pessoa pode gerenciar. Exige `agenda.ver`. |
| `GET /api/agenda/venda?loja=&numero=` | Acha o agendamento de uma venda pelo número. |
| `POST /api/agenda` | Cria agendamento. Confere o horário livre (ou aceita "encaixe"). Opcional: `coluna_id` liga a um chamado do WhatsApp; `enviar_whatsapp` manda a confirmação. Exige `agenda.gerenciar`. |
| `PUT /api/agenda/:id` | Muda situação, dados ou horário (remarcação manual fica no histórico; reabre se estava cancelado; atualiza a data da venda `futuro`/`aberta`). Marcar "confirmado" manda a mensagem com endereço e Waze. |
| `POST /api/agenda/:id/confirmacao` | Manda (de novo) a pergunta de confirmação com botões SIM / NÃO. |
| `PUT /api/agenda/config` | Horários por dia da semana, almoço, duração (5–480 min), vagas (1–50), antecedência (0–10080 min), dias à frente (1–365), ativo. |
| `POST /api/agenda/bloqueios`, `DELETE /api/agenda/bloqueios/:id` | Cria e remove bloqueios. |

Funções internas de `agenda.js`: `config()` (cria a configuração padrão se faltar), `horarioValido()` (trava a agenda da loja com `pg_advisory_xact_lock` e confere em `agenda_livres`), `dadosAgendamento()` (nome, celular, placa, serviço e cliente; com CPF/CNPJ usa `resolverCliente`), `ligarChamado()`, `mandarConfirmacao()`, `avisarConfirmado()`.

### `confirmacaoAgenda.js`

| Função | O que faz |
| --- | --- |
| `responderConfirmacao(contatoId, { enviarTexto })` | Chamada pelo WhatsApp **antes do robô**. Se o contato tem confirmação pendente: SIM → confirmado + mensagem com endereço e Waze; NÃO → pergunta o dia, depois a hora (lista numerada) e remarca. "ATENDENTE", "HUMANO", "PESSOA" ou "CANCELAR", ou duas respostas não entendidas, encerram a confirmação e a conversa segue normal. Devolve `true` se a mensagem era sobre a confirmação. |
| `lerDia(texto)` | Entende "30/10", "30/10/2026", "30", "dia 30", "hoje", "amanhã", "depois de amanhã", nome do dia da semana. Dia sem mês que já passou vai para o mês seguinte. |
| `lerHora(texto, opcoes)` | Número da lista ou hora ("14:30", "14h", "14h30"). |

### Banco

| Função | O que faz |
| --- | --- |
| `agenda_livres(loja, de, ate)` | Gera os horários livres: dentro do horário do dia, fora do almoço, depois da antecedência, até `dias_a_frente`, sem bloqueio e com vaga sobrando. |
| `app_agenda_robo(chamado, inicio, dados)` | Agenda pelo robô (sem usuário logado), conferindo de novo se o horário está livre; atualiza a data da venda `futuro`. |
| `app_agenda_livres_robo`, `app_agenda_loja_robo` (`db/23`) e `app_agenda_livres_unidade`, `app_agenda_unidade_robo` (`db/30`) | Horários livres e dados da loja para o robô. |
| `chamado_liga_agendamento()` (gatilho em `whatsapp_chamados`) | Quando o robô abre a venda do chamado, o agendamento ganha a venda e os dados finais. |
| `tel_chave(tel)` | DDD + 8 últimos dígitos (o mesmo celular com ou sem 55 e com ou sem o 9). |
| `app_agenda_confirmacao_pendente`, `app_agenda_confirmacao_passo`, `app_agenda_resposta_cliente`, `app_agenda_remarcar_cliente`, `app_agenda_registrar_conversa` | Passos da confirmação pelo WhatsApp. |
| `app_agenda_mover_chamado(ag, coluna)`, gatilho `trg_agenda_coluna_chamado` | `agendado` → coluna cujo nome começa com CONFIRMAR; `confirmado` → coluna que começa com AGENDADO. |
| `app_agenda_concluir_chamado`, gatilho `trg_agenda_concluir_chamado` | `compareceu` → coluna que finaliza o chamado. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md), [grupos-e-unidades](grupos-e-unidades.md) (endereço da loja), [clientes](clientes.md) (`resolverCliente`, `EditorCliente`), [servicos](servicos.md), [consulta-placa-e-fipe](consulta-placa-e-fipe.md) (`normalizarPlaca`), [whatsapp-e-robo](whatsapp-e-robo.md) (`enviarTexto`, `enviarOpcoes`, `internacional`, contatos, chamados e colunas).
- **Quem depende dele:** [whatsapp-e-robo](whatsapp-e-robo.md) (o robô oferece horários e agenda; a confirmação roda antes do robô), [vendas](vendas.md) (venda aberta a partir do agendamento; "compareceu").

## Tabelas usadas

`agenda_config`, `agenda_bloqueios`, `agendamentos`, `agenda_historico`, `whatsapp_contatos`, `whatsapp_chamados`, `whatsapp_colunas`, `whatsapp_conversa`, `whatsapp_numeros`, `vendas`, `servicos`, `clientes`, `lojas`.

## Regras de negócio e casos especiais

- Situações: `agendado`, `confirmado`, `compareceu`, `faltou`, `cancelado`. Origem: `manual` ou `whatsapp`.
- Padrão de horário: segunda a sexta 08:00–17:00, sábado 08:00–12:00, almoço 12:00–13:00, 30 min por vistoria, 1 vaga, 60 min de antecedência, 30 dias à frente.
- Agendar fora dos horários livres só com **Encaixe**.
- A trava `pg_advisory_xact_lock(hashtext('agenda:' || loja))` evita que duas pessoas (ou o robô) peguem a mesma vaga ao mesmo tempo.
- A confirmação manda a pergunta com botões SIM / NÃO. O endereço e o link do Waze (encurtado, a não ser com `ENCURTADOR=0`) só vão quando o agendamento é confirmado.
- A confirmação pendente só vale para agendamentos `agendado`/`confirmado` que começam depois de 12 horas atrás.
- Toda remarcação (manual ou pelo cliente) e cada resposta SIM/NÃO ficam em `agenda_historico`, que a tela mostra no dia de onde o agendamento saiu.
- Quem vê vendas ganhou `agenda.ver` e quem cria vendas ganhou `agenda.gerenciar` na migração `db/23`.

## Pontos frágeis, TODOs e dívidas técnicas

- `GET /api/agenda` grava no banco: cria a configuração padrão da loja e as colunas padrão do quadro do WhatsApp (`app_whatsapp_colunas_padrao`).
- As colunas do quadro são achadas **pelo começo do nome** (CONFIRMAR, AGENDADO). Renomear a coluna faz o chamado parar de andar sozinho.
- Os textos em `confirmacaoAgenda.js` (SIM/NÃO por expressão regular) podem entender errado respostas livres; depois de 2 tentativas a conversa sai da confirmação.
- `encurtar()` usa serviços externos (is.gd, tinyurl) e guarda o resultado só na memória do processo.
- Funções sem uso no código atual: `app_agenda_livres_robo` e `app_agenda_loja_robo` (`db/23`) e `app_agenda_unidade_robo` (`db/30`). O `robo.js` chama só `app_agenda_livres_unidade` e `app_agenda_robo`.
- `confirmacaoAgenda.js` roda com `comoUsuario(null, ...)` (sem usuário), dependendo das funções `security definer` para passar pela RLS.
