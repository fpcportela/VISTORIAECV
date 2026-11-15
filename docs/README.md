# Vistoria ECV · documentação técnica

Documentação gerada a partir do código do ramo `consulta-placa`. Ela descreve só o que está no código; os pontos que não deu para confirmar estão marcados com "⚠️ verificar".

## Visão geral

O Vistoria ECV é um ERP para franquias de vistoria veicular (ECV). Ele cuida da **venda** das vistorias e da gestão da loja; a vistoria em si é feita no sistema obrigatório do Detran (por isso o módulo de vistorias está oculto).

O que o sistema faz hoje:

- vendas com preço travado por serviço, cliente e tipo de veículo, pagamentos e numeração por grupo;
- cadastro de clientes (CPF/CNPJ sem duplicar, grupos de clientes, preços especiais);
- consulta de placa paga (API Placas) com cache de 30 dias e listas da tabela FIPE;
- agenda de vistorias por loja, com confirmação pelo WhatsApp;
- WhatsApp por grupo (API oficial da Meta ou QR code pela Evolution API), quadro de chamados e robô de atendimento com fluxo em blocos e IA (Claude);
- financeiro (contas a pagar e a receber, baixas, plano de contas, centros de custo, caixa e bancos);
- relatórios montados pela pessoa e faturamento de vendas em conta a receber;
- colaboradores e controle de ponto com foto e comprovante pelo WhatsApp;
- usuários, perfis e permissões por loja, com acesso garantido pelo banco (RLS);
- backup e recuperação, e uso em dois computadores com os dados passando pelo Google Drive.

Hierarquia da rede: **franquia → grupo (tabela `empresas`) → unidade/loja (tabela `lojas`)**. O usuário "master" (`admin_rede`) vê todos os grupos.

## Stack

| Parte | Tecnologia |
| --- | --- |
| Banco | PostgreSQL 16 no Docker (contêiner `vistoria-ecv-banco`), com RLS e regras em funções SQL. |
| API | Node.js (ES modules) + Express 4.21, `pg`, `jsonwebtoken`, `@anthropic-ai/sdk`, `jspdf` (comprovante do ponto). Porta 3001. |
| Front-end | React 18.3 + Vite 5.4, app instalável (PWA), `jspdf` + `jspdf-autotable` para PDFs. Porta 5173. |
| WhatsApp | API oficial da Meta (WhatsApp Cloud API) ou Evolution API v2.3.7 (Docker, opcional). |
| Integrações | API Placas, FIPE (parallelum), BrasilAPI / Minha Receita / CNPJ.ws (CNPJ), ViaCEP / BrasilAPI (CEP), API da Anthropic (IA do robô), is.gd / tinyurl (links curtos). |
| Scripts | Node.js: atualização pelo GitHub e sincronização pelo Google Drive. |

## Como rodar

Pré-requisitos: Node.js 20 ou mais novo e Docker Desktop (conforme o `README.md` da raiz).

```bash
npm run instalar                 # instala raiz, api e web
cp api/.env.exemplo api/.env     # configuração da API (banco, JWT, API Placas...)
npm run banco                    # liga o PostgreSQL (na 1ª vez cria as tabelas com db/01..04)
npm run banco:atualizar          # aplica as migrações db/02 e db/05 em diante (pode rodar sempre)
npm run dev                      # desenvolvimento: API + Vite com recarga
# ou
npm run iniciar                  # uso: gera o front e liga API + vite preview
```

Abrir `http://localhost:5173`. As chamadas `/api` são repassadas para `http://localhost:3001` (`web/vite.config.js`).

No dia a dia, os atalhos `Abrir Vistoria ECV (Mac).command` e `Abrir Vistoria ECV (Windows).bat` fazem tudo: ligam o Docker, atualizam o sistema pelo GitHub, ligam o banco, trazem os dados do Google Drive e abrem o navegador. Ver [inicializacao-e-sincronizacao](modulos/inicializacao-e-sincronizacao.md).

Variáveis principais (`api/.env`): `DATABASE_URL`, `JWT_SECRET`, `PORT`, `API_PLACAS_TOKEN`, `API_PLACAS_ROTA`, `API_PLACAS_CACHE_DIAS`, `WHATSAPP_*`, `EVOLUTION_*`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODELO`, `BACKUP_*`, `ENCURTADOR`. Na raiz (`.env`): `DB_ADMIN_PASSWORD`, `APP_DB_PASSWORD`, `EVOLUTION_API_KEY`, `VISTORIA_RAMO`, `VISTORIA_DRIVE_PASTA`, `VISTORIA_MAQUINA`.

## Estrutura de pastas

```
.
├── api/                  API Node/Express
│   ├── src/index.js      inicia o servidor, login, /api/eu, /api/inicio, /api/placa e registra as rotas
│   ├── src/db.js         conexão e comoUsuario() (transação com o usuário e o grupo para a RLS)
│   ├── src/comum.js      Recusa, validações, exigir(), resolverCliente()
│   └── src/*.js          um arquivo por módulo (vendas, financeiro, whatsapp, robo, agenda...)
├── web/                  front-end React (Vite)
│   ├── src/Inicio.jsx    casca do sistema (menu, topo, painel) que abre as outras telas
│   ├── src/*.jsx         uma tela por módulo
│   └── public/           manifest, ícone e service worker (PWA)
├── db/                   SQL do banco: 01 (esquema), 02..40 (migrações), 03/04 (só na criação)
├── scripts/              abrir.mjs, atualizar.mjs, drive.mjs
├── docker-compose.yml    banco (e WhatsApp por QR code, opcional)
├── README.md, LEIA-ME.md guias de uso em português
└── docs/                 esta documentação
```

## Índice

- [Arquitetura](arquitetura.md): fluxo de dados, integrações, banco e decisões de design.

### Módulos

| Módulo | Assunto |
| --- | --- |
| [acesso-e-usuarios](modulos/acesso-e-usuarios.md) | Login, JWT, perfis, permissões por loja, cargos, RLS, cor do tema. |
| [grupos-e-unidades](modulos/grupos-e-unidades.md) | Grupos (empresas), unidades (lojas), logo, preparação de grupo novo. |
| [servicos](modulos/servicos.md) | Serviços e produtos, preços por tipo de veículo. |
| [vendas](modulos/vendas.md) | Vendas, itens, pagamentos, situações, preço travado e autorização. |
| [clientes](modulos/clientes.md) | Clientes PF/PJ/grupo, preços especiais, CNPJ e CEP. |
| [consulta-placa-e-fipe](modulos/consulta-placa-e-fipe.md) | API Placas com cache e listas FIPE. |
| [agenda](modulos/agenda.md) | Agenda por loja e confirmação pelo WhatsApp. |
| [whatsapp-e-robo](modulos/whatsapp-e-robo.md) | WhatsApp (Meta/Evolution), quadro de chamados, robô e IA. |
| [financeiro](modulos/financeiro.md) | Contas a pagar e receber, baixas, plano de contas, caixa e bancos. |
| [relatorios](modulos/relatorios.md) | Relatório personalizado, PDFs e faturamento de vendas. |
| [colaboradores-e-ponto](modulos/colaboradores-e-ponto.md) | Colaboradores, ponto com foto, comprovante. |
| [inicio](modulos/inicio.md) | Tela principal, menu, pesquisa geral e painel. |
| [backup-e-recuperacao](modulos/backup-e-recuperacao.md) | Backup completo e importação (sobrescrever ou combinar). |
| [inicializacao-e-sincronizacao](modulos/inicializacao-e-sincronizacao.md) | Atalhos, atualização pelo GitHub, Google Drive. |
| [interface-comum](modulos/interface-comum.md) | `api.js`, regras de digitação, datas, ícones, estilo, PWA. |
| [vistorias](modulos/vistorias.md) | Módulo oculto de execução de vistoria (checklist). |

Royalties e maquininhas/bancos existem só no banco (sem tela nem rota); estão descritos em [arquitetura](arquitetura.md#partes-que-existem-só-no-banco).
