# Módulo: WhatsApp e robô de atendimento

## Objetivo

Atender os clientes de cada grupo pelo WhatsApp dentro do sistema:

- **Conversas:** receber e responder mensagens de um número por grupo, pela API oficial da Meta (WhatsApp Cloud API) ou pela Evolution API (WhatsApp ligado por QR code).
- **Quadro de chamados (kanban):** cada contato tem no máximo um chamado aberto, que anda por colunas configuráveis.
- **Robô:** um fluxo em blocos (mensagem, menu, pergunta, IA, venda, atendente, transferir, fim) coleta os dados do cliente e do veículo, oferece horários da agenda e abre uma venda FUTURO. Pode usar IA (Claude) com uma base de conhecimento, só nos grupos em que o master liberou.
- **Envio de códigos e documentos:** código de "Esqueci a senha" e comprovante de ponto.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/whatsapp.js` | Provedores (Meta, Evolution, teste), funções de envio, webhooks, "Esqueci a senha" e todas as rotas `/api/whatsapp/...`. |
| `api/src/robo.js` | Motor do robô: fluxo em blocos, validação das respostas, horários livres, abertura da venda, chamada à IA, fila por contato. |
| `api/src/confirmacaoAgenda.js` | Resposta à confirmação do agendamento; roda antes do robô (ver [agenda](agenda.md)). |
| `web/src/WhatsApp.jsx` | Tela com abas: `Quadro` (kanban), `Conversas`/`Conversa`, `Robo` (editor do fluxo e das unidades), `BaseConhecimento`, `ConectarQr`, `ConfigurarMeta`, `Simular` (modo teste). Atualiza a cada 8 s quando a aba está visível. |
| `web/src/Fluxograma.jsx` | Desenho do fluxo do robô em camadas, ligação entre blocos com clique e os modelos prontos (`MODELOS`): "Agendamento de vistoria (menu com botões)", "Atendimento com IA (agenda sozinho)", "Menu com botões + IA para dúvidas", "Orçamento rápido". |
| `db/15-acesso-colaborador-whatsapp.sql` | `whatsapp_numeros`, `whatsapp_contatos`, `whatsapp_colunas`, `whatsapp_chamados`, `whatsapp_conversa`, as funções do webhook e as de "Esqueci a senha". |
| `db/18-whatsapp-robo.sql` | `empresas.ia_liberada` (só o master muda), `whatsapp_robo`, estado do robô no chamado, `app_robo_abrir_venda`, `app_robo_contexto`, `app_robo_estado`, `app_robo_registrar`. |
| `db/27-robo-fluxo-conhecimento.sql` | `whatsapp_robo.fluxo` (blocos) e `whatsapp_conhecimento` (base da IA), `app_robo_conhecimento`. |
| `db/30-unidades-robo.sql` | Endereço do grupo, responsável por unidade, `robo_unidade`, `app_agenda_livres_unidade`, `app_robo_atribuir`. |
| `db/34-robo-botoes.sql` | `whatsapp_robo.botoes` (opções como botões; padrão ligado). |
| `db/35-robo-transferir.sql` | `app_robo_transferir` (bloco Transferir) e o índice de `agendamentos` por `tel_chave` (ícone da agenda no quadro). |
| `db/39-robo-texto-em-breve.sql` | Troca "Em instantes um atendente confirma" por "Em breve um atendente confirma" nos textos salvos. |

## Funções e rotas públicas

### Envio (`whatsapp.js`)

| Função | O que faz |
| --- | --- |
| `provedor()` | `meta`, `evolution` ou `teste`, conforme `WHATSAPP_PROVEDOR` e as chaves presentes no `.env`. |
| `internacional(tel)` / `nacional(tel)` | Converte para 55 + DDD + número e de volta para o formato do cadastro do cliente. |
| `enviarTexto(...)` | Manda texto; devolve `{ id_externo, status }`. No modo teste a mensagem fica como `simulada`. |
| `enviarOpcoes(...)` | Meta: botões (até 3 opções) ou lista (até 10); acima disso, texto numerado. Evolution: botões só com `EVOLUTION_BOTOES=1`, senão texto numerado. |
| `enviarDocumento(...)` | Meta: modelo aprovado `WHATSAPP_MODELO_PONTO` (padrão `comprovante_ponto`) com o documento no cabeçalho. Evolution: manda o arquivo direto. Usado pelo comprovante de ponto. |
| `enviarCodigo(...)` | Código de "Esqueci a senha" pelo modelo `WHATSAPP_MODELO_CODIGO` (padrão `codigo_acesso`). No modo teste o código sai no console da API. |
| `numeroDoGrupo(db, loja)` | Número (`phone_number_id`) ativo do grupo da loja. |

Erros da Meta tratados com mensagem própria: fora da janela de 24 horas (131047/131026) e token vencido (190).

### Rotas

| Rota | O que faz |
| --- | --- |
| `POST /api/senha/codigo`, `POST /api/senha/redefinir` | "Esqueci a senha". Até 10 tentativas por IP a cada 15 min (contador na memória). A resposta do pedido é sempre a mesma, para não revelar se o usuário existe. |
| `GET /api/whatsapp/webhook` | Verificação do webhook da Meta (`WHATSAPP_VERIFY_TOKEN`). |
| `POST /api/whatsapp/webhook` | Mensagens e status da Meta. Confere a assinatura `x-hub-signature-256` (HMAC com `WHATSAPP_APP_SECRET`); sem o segredo, recusa tudo (401). Responde 200 e só depois roda o robô. |
| `POST /api/whatsapp/evolution` | Webhook da Evolution. Confere o cabeçalho `x-vistoria-chave` (sha256 de `webhook:` + `EVOLUTION_API_KEY`). Ignora mensagens da própria loja e o que não for conversa de pessoa (`@s.whatsapp.net`). Mídia sem texto vira "[Imagem recebida: abra no celular]" e parecidos. |
| `GET /api/whatsapp/evolution/estado`, `POST .../conectar`, `POST .../desconectar` | Situação da instância, QR code (base64) e desligar. Conectar e desconectar só para o master. A instância se chama `vistoria-<id do grupo>`. |
| `GET /api/whatsapp/contadores` | Não lidas e chamados abertos (o menu lateral consulta a cada 20 s). |
| `GET /api/whatsapp/situacao`, `PUT /api/whatsapp/numero` | Provedor e número do grupo; cadastrar o `phone_number_id` da Meta (só master). |
| `POST /api/whatsapp/simular` | Só no modo teste: simula uma mensagem recebida (número falso `teste-<grupo>`). |
| `GET /api/whatsapp/quadro` | Colunas, chamados (com contato, responsável, venda e agendamento achado pelo `tel_chave`) e responsáveis possíveis. Cria as colunas padrão se faltarem. |
| `POST/PUT/DELETE /api/whatsapp/colunas[/:id]` | Criar (entra antes da coluna que finaliza), renomear, reordenar, excluir. A coluna que finaliza não pode ser excluída e precisa sobrar ao menos uma coluna aberta. |
| `POST/PUT /api/whatsapp/chamados[/:id]` | Criar chamado (um contato não pode ter dois abertos), mover, mudar título e responsável. Entrar na coluna que finaliza fecha o chamado. |
| `POST /api/whatsapp/chamados/:id/robo` | O atendente assume (`humano`) ou devolve ao robô (`coletando`). |
| `GET/PUT /api/whatsapp/robo` | Configuração do robô. O PUT valida o fluxo (`normalizarFluxo`), exige IA liberada para usar bloco de IA, confere que os responsáveis são do grupo e grava endereço e horário de cada unidade (`app_unidade_endereco_horario`). |
| `PUT /api/whatsapp/robo/ia` | Master libera ou bloqueia a IA para o grupo (`empresas.ia_liberada`). |
| `GET/POST/PUT/DELETE /api/whatsapp/conhecimento...` | Base de conhecimento: texto digitado ou arquivo (PDF, TXT, MD, CSV), até 10 MB por arquivo e 30 MB no total do grupo, guardado no banco. Mudanças limpam o cache da IA (`esquecerConhecimento`). |
| `GET /api/whatsapp/contatos`, `GET/PUT /api/whatsapp/contatos/:id` | Lista (até 200), conversa (últimas 300 mensagens; `ler=1` zera as não lidas) e ligação com o cliente. Ao abrir, liga sozinho o cliente se houver exatamente um com o mesmo telefone (`tel_chave`). |
| `POST /api/whatsapp/contatos/:id/mensagens` | Atendente manda mensagem. O robô para (`humano`) e o chamado ganha o atendente como responsável se ainda não tinha. |

Permissões: `whatsapp.ver` para ver e `whatsapp.enviar` para mandar mensagens e mexer em chamados, colunas, robô e base (`exigirEnvio`). As rotas pegam o grupo por `grupoDoWhatsApp`, que exige um único grupo: o master precisa escolher o grupo no topo.

### Robô (`robo.js`)

| Função | O que faz |
| --- | --- |
| `atenderComRobo(contatoId)` | Chamada pelos webhooks e pela simulação. Põe a mensagem numa fila **por contato** (na memória) e chama primeiro `responderConfirmacao` (agenda); se não era sobre confirmação, chama `atender`. |
| `atender` (interna) | Lê o contexto (`app_robo_contexto`). Para se o chamado já tem venda ou o robô está `concluido`/`humano`. Com várias unidades ativas, pergunta a unidade primeiro. Cliente reconhecido pelo telefone é chamado pelo nome e nome/CPF/e-mail já vêm do cadastro. "ATENDENTE", "HUMANO" ou "PESSOA" passam para um atendente. |
| `executar` (interna) | Anda pelos blocos até precisar de resposta, no máximo 60 passos por mensagem (proteção contra laço). |
| `fluxoDe(robo)` | Usa `whatsapp_robo.fluxo`; se estiver vazio, monta um fluxo a partir das `etapas` antigas. |
| `normalizarFluxo(fluxo)` | Valida o fluxo salvo: até 60 blocos, até 12 opções por menu, tipos de bloco e campos conhecidos. |
| `conferir(campo, resposta, servicos)` | Valida cada resposta: nome, CPF/CNPJ (com dígito), placa (`normalizarPlaca`), tipo de veículo, serviço, data, horário, e-mail, texto livre. |
| `horariosLivres` / `reservar` (internas) | Até 12 horários por vez ("MAIS" mostra outros) via `app_agenda_livres_unidade`; reserva com `app_agenda_robo`. |
| `paraVenda` + `app_robo_abrir_venda` | Monta os dados e abre a venda FUTURO (ver regras abaixo). |
| `perguntarIA` (interna) | Chama a API da Anthropic com o modelo `ANTHROPIC_MODELO` (padrão `claude-opus-5-5`), até 4000 tokens, cache de prompt (instruções e documentos), esforço baixo e saída em JSON pelo esquema `ESQUEMA`. A base ativa vai como documentos (cache de 1 min por grupo). Recusa ou erro da IA passa para um atendente. |
| `iaDisponivel()` | Há `ANTHROPIC_API_KEY` no `.env`? |

Campos que o robô coleta (`CAMPOS`): `nome`, `cpf_cnpj`, `placa`, `tipo_veiculo`, `servico`, `data`, `horario`, `email`, `livre`.

### Banco

| Função | O que faz |
| --- | --- |
| `app_whatsapp_receber(phone_number_id, telefone, nome, texto, id_externo, quando)` | Acha o grupo pelo número (na Evolution, o "número" é o nome da instância), cria ou acha o contato e o chamado aberto, grava a mensagem e soma uma não lida. Ignora mensagem repetida (mesmo `id_externo`). |
| `app_whatsapp_status(id_externo, status, erro)` | Entregue, lida ou falhou; não volta de "lida" para "entregue". |
| `app_whatsapp_colunas_padrao(grupo)` | NOVO, EM ATENDIMENTO, AGUARDANDO CLIENTE, CONCLUIDO (esta finaliza), só se o grupo não tiver nenhuma coluna. |
| `app_whatsapp_chamado_do_contato(grupo, contato, usuario)` | Chamado aberto do contato ou um novo no topo da primeira coluna aberta. |
| `app_robo_contexto(contato)` | Tudo que o robô precisa: configuração, chamado, serviços, mensagens, unidades, cliente. |
| `app_robo_estado`, `app_robo_registrar` | Grava o estado/etapa/dados do robô no chamado e as mensagens que o robô mandou (`robo = true`). |
| `app_robo_abrir_venda(chamado, dados)` | Abre a venda FUTURO (uma por chamado; chamar de novo devolve a mesma). |
| `robo_unidade(grupo, loja)` | Unidade da conversa: a escolhida, senão a do robô (`whatsapp_robo.loja_id`), senão a primeira ativa por nome. |
| `app_robo_atribuir(chamado, loja)` | Dá o chamado ao responsável da unidade (`responsaveis`) ou ao padrão (`responsavel_id`), se ainda não tem responsável. |
| `app_robo_transferir(chamado, coluna, responsavel)` | Move para uma coluna do mesmo grupo que não finaliza e/ou troca o responsável (usuário ativo do grupo ou master). |
| `app_robo_conhecimento(grupo)` | Base de conhecimento ativa (PDF em base64). |
| `empresas_ia_so_master()` (gatilho) | Só o master muda `empresas.ia_liberada`. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md) (permissões, `comoUsuario`), [grupos-e-unidades](grupos-e-unidades.md) (lojas, endereço), [clientes](clientes.md) (reconhecimento pelo telefone, criação do cliente), [servicos](servicos.md), [vendas](vendas.md) (venda FUTURO), [agenda](agenda.md) (horários, confirmação, `tel_chave`), [consulta-placa-e-fipe](consulta-placa-e-fipe.md) (`normalizarPlaca`, tabela `veiculos`). Externos: Meta Cloud API (Graph `WHATSAPP_GRAPH_URL`, padrão v21.0), Evolution API (serviço opcional no `docker-compose.yml`, perfil `whatsapp`), API da Anthropic.
- **Quem depende dele:** [agenda](agenda.md) (manda confirmação e "confirmado"), [vendas](vendas.md) (venda aberta pelo robô; responsável do chamado), [acesso-e-usuarios](acesso-e-usuarios.md) ("Esqueci a senha"), [colaboradores-e-ponto](colaboradores-e-ponto.md) (comprovante de ponto por `enviarDocumento`), [inicio](inicio.md) (contadores no menu lateral).

## Tabelas usadas

`whatsapp_numeros`, `whatsapp_contatos`, `whatsapp_colunas`, `whatsapp_chamados`, `whatsapp_conversa`, `whatsapp_robo`, `whatsapp_conhecimento`, `empresas` (`ia_liberada`, endereço), `lojas`, `clientes`, `servicos`, `vendas`, `venda_itens`, `venda_historico`, `veiculos`, `agendamentos`, `agenda_config`, `usuarios`, `usuario_lojas`, `senha_codigos`. Todas as tabelas `whatsapp_*` têm RLS por grupo (`tem_empresa`). Auditoria só em `whatsapp_colunas`.

## Regras de negócio e casos especiais

- **Um número por grupo** (`whatsapp_numeros.empresa_id` é chave primária). O mesmo número não pode ser de dois grupos.
- **Um chamado aberto por contato.** Mensagem nova de um contato sem chamado aberto cria um chamado na primeira coluna aberta; o robô começa o fluxo do zero nesse chamado novo.
- Estados do robô no chamado: `coletando`, `concluido`, `humano`. Quando um atendente responde ou assume, o robô para naquele chamado.
- **Venda aberta pelo robô** (`app_robo_abrir_venda`):
  - Loja: `robo_unidade` (escolhida na conversa, a do robô ou a primeira ativa). Sem loja ativa: erro.
  - Cliente: pelo CPF/CNPJ (cria se não existir, ou completa o tipo/telefone/e-mail); sem documento, o cliente ligado ao contato ou o "CLIENTE PARTICULAR / AVULSO". O contato fica ligado ao cliente.
  - Serviço: o escolhido na conversa, senão o do robô (`whatsapp_robo.servico_id`), senão um serviço ativo do grupo.
  - Placa: grava/atualiza o tipo em `veiculos`.
  - A venda é `futuro`, com histórico, e o chamado ganha título "VENDA Nº …" e estado `concluido`.
- **IA:** só funciona com a chave da Anthropic no `.env` **e** com o grupo liberado pelo master. Sem isso, um bloco de IA passa a conversa para um atendente.
- Com várias unidades ativas, o robô pergunta a unidade antes de tudo e passa o chamado para o responsável daquela unidade.
- Respostas de botão como "2. Agendar vistoria" contam como o número da opção; "OUTROS HORARIOS" conta como "MAIS".
- Mensagem final padrão do robô: "Em breve um atendente confirma com você" (`db/39` trocou o texto antigo nos dados salvos).
- O quadro mostra o ícone da agenda no chamado quando há agendamento com o mesmo celular (`tel_chave`, índice criado em `db/35`).

## Pontos frágeis, TODOs e dívidas técnicas

- A **fila por contato** (`atenderComRobo`), o contador de tentativas do "Esqueci a senha" e o cache da base de conhecimento ficam **na memória do processo**: reiniciar a API perde tudo, e duas instâncias da API não se enxergam.
- O robô roda depois de responder 200 ao webhook. Se a API cair no meio, a mensagem fica gravada mas o robô não responde (não há nova tentativa).
- A tabela antiga `whatsapp_mensagens` (`db/01`) não é usada pelo código atual; o módulo usa `whatsapp_conversa`.
- Na Evolution, `whatsapp_numeros.phone_number_id` guarda o **nome da instância**, não um id da Meta. O mesmo campo tem significados diferentes conforme o provedor.
- Botões têm duas chaves: `whatsapp_robo.botoes` (por grupo, padrão ligado) e, na Evolution, também `EVOLUTION_BOTOES=1` no `.env` (desligado por padrão porque, segundo o comentário no código, "o WhatsApp comum costuma esconder botões"). Sem botões, as opções vão em texto numerado.
- O fluxo antigo (`etapas`, `saudacao`, `mensagem_final`) continua no banco e no código como alternativa quando `fluxo` está vazio.
- `app_agenda_livres_robo`, `app_agenda_loja_robo` e `app_agenda_unidade_robo` existem no banco, mas o código não chama.
- A base de conhecimento fica dentro do banco (`bytea`), o que aumenta os backups.
- O modelo padrão da IA está fixo no código (`claude-opus-5-5`) quando `ANTHROPIC_MODELO` não é informado.
