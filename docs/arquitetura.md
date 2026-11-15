# Arquitetura

Visão do sistema como um todo. Os detalhes de cada parte estão nos [módulos](README.md#módulos).

## Componentes

```
Navegador (React/Vite, PWA)  ──/api──►  API Node/Express (porta 3001)  ──pg──►  PostgreSQL 16 (Docker)
        ▲                                   │    ▲                                   ▲
        │                                   │    │ webhooks                          │ pg_dump / pg_restore
        │                                   ▼    │                                   │
        │                     Serviços externos: API Placas, FIPE,          scripts/ (atalho, GitHub,
        │                     CNPJ/CEP, Meta/Evolution, Anthropic,          Google Drive)
        │                     is.gd/tinyurl
```

- O **front-end** (`web/`) é servido pelo Vite (`dev` ou `preview`) na porta 5173, que repassa `/api` para a API.
- A **API** (`api/src/index.js`) registra as rotas de cada módulo (`rotasVendas`, `rotasFinanceiro`, etc.) e fala com o banco só pelo usuário `app_api`.
- O **banco** guarda tudo, inclusive arquivos (fotos do ponto, anexos, PDFs, base de conhecimento do robô) em colunas `bytea`, e aplica as regras de acesso por linha (RLS).
- Os **scripts** (`scripts/`) cuidam de abrir o sistema, atualizar o código pelo GitHub e passar os dados entre dois computadores pelo Google Drive.

## Fluxo de dados de uma requisição

1. **Login:** `POST /api/login` chama `app_login(email, senha)` no banco (senha com `crypt`). A API devolve um JWT (`sub` = id do usuário, validade de 12 horas), que o front guarda no `localStorage`.
2. **Cada chamada** leva `Authorization: Bearer <token>` e, se o master escolheu um grupo no topo, `X-Grupo: <id>` (`web/src/api.js`).
3. `exigeLogin` confere o token e guarda o grupo num `AsyncLocalStorage` (`contexto`).
4. A rota chama `comoUsuario(usuarioId, fn)` (`api/src/db.js`), que abre uma transação e define:
   - `app.usuario_id` (quem está usando),
   - `app.grupo` (grupo escolhido pelo master),
   - fuso `America/Sao_Paulo` (o "hoje" é o do Brasil).
5. Dentro da transação, as **políticas RLS** filtram as linhas pelas funções `pode(loja, permissao)`, `tem_loja`, `tem_empresa`, `eh_admin_rede`, `grupo_ativo`. A API confere as permissões de cada ação com `exigir(db, loja, permissao)` e o banco confere de novo.
6. Erros: `Recusa(status, mensagem)` vira resposta com `{ erro }`. A função `rota()` traduz erros do banco: `42501` → 403, `23505` → 400 (duplicado), `22023`/`23503` → 400.
7. Partes que rodam **sem usuário logado** (webhooks do WhatsApp, robô, confirmação da agenda) usam `comoUsuario(null, ...)` e funções `security definer` do banco (`app_whatsapp_receber`, `app_robo_*`, `app_agenda_*`), que só fazem o que aquele fluxo precisa.

## Integrações externas

| Serviço | Para quê | Onde | Configuração |
| --- | --- | --- | --- |
| API Placas (`wdapi2.com.br`) | Dados do veículo pela placa (pago por consulta). | `api/src/placas.js`, `index.js` | `API_PLACAS_TOKEN`, `API_PLACAS_ROTA`, `API_PLACAS_CACHE_DIAS`, `API_PLACAS_URL` |
| FIPE (parallelum) | Marcas e modelos. | `api/src/fipe.js` | `FIPE_URL` |
| BrasilAPI, Minha Receita, CNPJ.ws | Dados públicos de CNPJ (tenta em ordem). | `api/src/documentos.js` | `BRASILAPI_URL`, `MINHARECEITA_URL`, `CNPJWS_URL` |
| ViaCEP, BrasilAPI | Endereço pelo CEP. | `api/src/documentos.js` | `VIACEP_URL` |
| Meta WhatsApp Cloud API | Mensagens, botões, modelos aprovados (código de senha, comprovante de ponto), webhook. | `api/src/whatsapp.js` | `WHATSAPP_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_GRAPH_URL`, `WHATSAPP_MODELO_*`, `WHATSAPP_IDIOMA` |
| Evolution API (Docker) | WhatsApp por QR code, sem a Meta. | `api/src/whatsapp.js`, `docker-compose.yml` | `WHATSAPP_PROVEDOR`, `EVOLUTION_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_WEBHOOK_URL`, `EVOLUTION_BOTOES` |
| API da Anthropic | IA do robô (respostas em JSON estruturado, base de conhecimento como documentos). | `api/src/robo.js` | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODELO` |
| is.gd, tinyurl | Encurtar o link do Waze na confirmação da agenda. | `api/src/agendaTexto.js` | `ENCURTADOR=0` desliga |
| GitHub | Atualização automática do código (ramo `consulta-placa`). | `scripts/atualizar.mjs` | `VISTORIA_RAMO` |
| Google Drive para computador | Pasta sincronizada com os backups (dois computadores). | `scripts/drive.mjs` | `VISTORIA_DRIVE_PASTA`, `VISTORIA_MAQUINA` |

Sem a configuração do WhatsApp, o módulo funciona em **modo teste** (mensagens só no sistema). Sem a chave da Anthropic, o robô funciona sem IA.

## Banco de dados

- 70 tabelas criadas pelos arquivos de `db/` (41 em `db/01-schema.sql`, as outras nas migrações).
- `db/01-schema.sql`: esquema inicial em 12 seções (rede, usuários, tema, clientes/veículos, serviços/vendas, vistorias, financeiro, maquininhas, royalties, ponto, WhatsApp/auditoria, RLS).
- `db/02-*.sql` e `db/05-*.sql` a `db/40-*.sql`: migrações escritas para poder rodar de novo (`if not exists`, `create or replace`), aplicadas em ordem por `npm run banco:atualizar`.
- `db/03-dados-iniciais.sql` e `db/04-usuario-app.sh`: só na criação do banco (dados de exemplo e o papel `app_api`).
- Não existem os arquivos `24-*` e `25-*`. O `db/26-precos-cliente.sql` diz que comissão e parceiros foram testados e deixados de lado, e remove o que tinha sido criado.

### Tabelas principais e relações

**Rede e acesso**
- `franquias` 1—N `empresas` (grupo) 1—N `lojas` (unidade).
- `usuarios` N—N `lojas` por `usuario_lojas` (com o `perfil_id` daquela loja). `perfis` N—N `permissoes` por `perfil_permissoes`. `usuarios.admin_rede` = master.
- `cargos` (por grupo), `usuario_atalhos` (menu e atalhos), `preferencias_tema` (cor por grupo ou por usuário), `senha_codigos` ("Esqueci a senha").

**Clientes, veículos e serviços**
- `clientes` (por grupo; `cpf_cnpj` único no grupo; `grupo_cliente_id` aponta para outro cliente do tipo `grupo`).
- `cliente_precos` (cliente × serviço, um valor).
- `veiculos` (placa única, **global**), `consultas_placa` (histórico por loja e usuário), `fipe_marcas`, `fipe_modelos` (globais).
- `servicos` (por grupo) 1—N `servico_precos` (por tipo de veículo e, opcionalmente, por loja).

**Vendas**
- `vendas` (loja, grupo, cliente, número por grupo via `contadores`) 1—N `venda_itens` (serviço, veículo) e 1—N `venda_pagamentos`; `venda_historico` registra cada ação.
- `lancamento_vendas` liga vendas faturadas a uma conta a receber.

**Financeiro**
- `lancamentos` (loja, tipo receber/pagar, `categorias_financeiras`, `centros_custo`) 1—N `lancamento_baixas` (com `contas_financeiras`) e 1—N `lancamento_arquivos`. View `resumo_contas`.

**Agenda e WhatsApp**
- `agenda_config` (por loja), `agenda_bloqueios`, `agendamentos` (loja, serviço, venda, cliente, chamado), `agenda_historico`.
- `whatsapp_numeros` (1 por grupo), `whatsapp_contatos` 1—N `whatsapp_chamados` (coluna em `whatsapp_colunas`, venda, estado do robô) e 1—N `whatsapp_conversa`. `whatsapp_robo` (1 por grupo, com o fluxo) e `whatsapp_conhecimento`.

**Pessoas e ponto**
- `colaboradores` (grupo, loja principal, cargo, usuário opcional) N—N `lojas` por `colaborador_lojas`; `colaborador_arquivos`, `tipos_arquivo`.
- `ponto_registros` (4 marcações por dia, ajustes encadeados por `ajuste_de`), `ponto_justificativas`, `ponto_justificativa_arquivos`, `ponto_comprovantes`.

**Outros**
- `auditoria` (gatilho genérico `auditar()` em várias tabelas), `relatorio_modelos`, `contadores`.
- Vistorias (oculto): `checklist_modelos`, `checklist_modelo_itens`, `vistorias`, `vistoria_itens`, `vistoria_fotos`.

### Partes que existem só no banco

Estas tabelas e funções estão em `db/01-schema.sql`, mas não há rota na API nem tela (no menu, os itens abrem "Este módulo será desenvolvido nas próximas etapas"):

- **Royalties:** `regras_royalty` (por franquia, grupo, loja e serviço; percentual ou valor fixo, mínimo, fundo de propaganda, vigência), `apuracoes_royalty` (uma por loja e mês, com status `rascunho` → `fechada` → `faturada` → `paga`), `apuracao_royalty_itens`, funções `regra_royalty_vigente` e `calcular_royalty`. Só o painel do início lê `apuracoes_royalty`. ⚠️ verificar como as apurações serão criadas, já que nada no código chama `calcular_royalty`.
- **Maquininhas e bancos:** `maquininhas`, `maquininha_taxas`, `transacoes_cartao`, `extrato_bancario`, `importacoes_arquivo`, e as permissões `financeiro.conciliar`, `financeiro.importar`, `maquininhas.ver`, `integracoes.gerenciar`.
- **Fornecedores:** `fornecedores` e `lancamentos.fornecedor_id`.
- **Tabelas antigas substituídas:** `jornadas` e `marcacoes_ponto` (trocadas por `ponto_registros`), `whatsapp_mensagens` (trocada por `whatsapp_conversa`).

## Decisões de design (como aparecem no código)

- **Segurança no banco, não só na API.** A API conecta com o papel `app_api`, que não é dono das tabelas; a RLS e as funções `pode`/`tem_empresa` valem para toda consulta. A API também confere as permissões para dar mensagens claras.
- **Permissões configuráveis por loja.** Cada vínculo usuário–loja tem um perfil; cada permissão tem `nivel` `consulta` ou `uso`. As permissões são criadas em várias migrações (`01`, `05`, `06`, `08`, `23`, `40`).
- **Regras críticas em gatilhos e funções SQL:** numeração por grupo (`numerar_por_grupo`, `contadores`), travas de venda finalizada, soma das baixas do financeiro, ligação agenda ↔ chamado ↔ venda, proibição de apagar usuários e colaboradores, auditoria.
- **Nada é apagado de verdade em cadastros importantes:** clientes, usuários, colaboradores e serviços são inativados; ajustes de ponto guardam a marcação original.
- **Arquivos dentro do banco** (`bytea`): um backup do banco leva tudo junto, ao custo de backups maiores.
- **Hora do Brasil** fixada na transação (`America/Sao_Paulo`) e datas sem hora tratadas como texto `AAAA-MM-DD` (`db.js`).
- **Texto em maiúsculas e sem acento** em todo o sistema (`web/src/entrada.js` e conversões na API).
- **Um computador de cada vez**, com os dados passando por backup no Google Drive (nunca o banco vivo no Drive), e atualização do código direto do GitHub no atalho.
- **Vistoria fora do sistema:** a execução da vistoria ficou oculta porque é feita no sistema do Detran; o painel conta "vistorias vendidas" pelas vendas.
- **Migrações que podem rodar de novo**, aplicadas em toda atualização, em vez de um controle de versão de migrações.

## Pontos de atenção gerais

- Segredo padrão do JWT no código (`troque-este-segredo-em-producao`) e senhas padrão do banco no `docker-compose.yml` quando o `.env` não informa.
- Estado guardado na memória da API (fila do robô, cache da IA, limite de tentativas do "Esqueci a senha", análises de importação, links curtos): some ao reiniciar e não funciona com mais de uma instância da API.
- Não há testes automatizados no repositório (nenhum arquivo de teste e nenhum script `test` nos `package.json`).
- O código não tem comentários `TODO` ou `FIXME`; as dívidas técnicas destes documentos vêm da leitura do código.
- Funções de apoio copiadas entre arquivos (`dataValida`, `dinheiro`, validação de CPF/CNPJ no front e na API).
