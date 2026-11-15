# Módulo: Inicialização, atualização automática e sincronização pelo Google Drive

## Objetivo

Deixar o sistema pronto para uso com um clique no atalho da área de trabalho, em dois computadores (um de cada vez):

1. liga o Docker;
2. baixa e instala a versão nova do sistema do GitHub, se houver, e atualiza as regras do banco;
3. liga o banco (e o WhatsApp por QR code, se configurado);
4. traz os dados mais novos do Google Drive, liga o app e abre o navegador;
5. ao fechar (Ctrl+C), salva os dados no Drive e libera para o outro computador.

O banco de verdade **nunca** fica no Drive: o Drive guarda só arquivos de backup (`pg_dump`).

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `Abrir Vistoria ECV (Mac).command` | Atalho do Mac: roda `node scripts/abrir.mjs` e grava a saída em `~/vistoria-app.log`. |
| `Abrir Vistoria ECV (Windows).bat` | Atalho do Windows: tudo numa linha só, porque a atualização pode trocar o próprio arquivo. |
| `scripts/abrir.mjs` | Passo a passo do atalho (Docker → atualizar → banco/WhatsApp → `drive.mjs iniciar`). |
| `scripts/atualizar.mjs` | Atualização pelo GitHub e `--banco` (roda as migrações). |
| `scripts/drive.mjs` | Trava, backup e restauração pelo Google Drive; liga o app (`npm run iniciar`). |
| `package.json` (raiz) | Comandos `npm run ...` (ver abaixo). |
| `docker-compose.yml` | Serviço `banco` (PostgreSQL 16, contêiner `vistoria-ecv-banco`, porta 5432) e serviço opcional `whatsapp` (Evolution API v2.3.7, perfil `whatsapp`, porta 8080 só em `127.0.0.1`). |
| `db/04-usuario-app.sh` | Cria o papel `app_api` usado pela API (roda só na criação do banco). |

## Funções e comandos públicos

### `npm run ...` (raiz)

| Comando | O que faz |
| --- | --- |
| `instalar` | `npm install` na raiz, em `api` e em `web`. |
| `banco`, `banco:parar`, `banco:zerar` | Liga, para ou **apaga e recria** o banco (`docker compose down -v`). |
| `banco:atualizar` | `node scripts/atualizar.mjs --banco`. |
| `iniciar` | Gera o front (`vite build`) e liga a API e o `vite preview` juntos. |
| `dev` | API e front em modo de desenvolvimento. |
| `abrir` | O mesmo que o atalho. |
| `atualizar` | Confere e instala versão nova. |
| `drive:iniciar`, `drive:salvar`, `drive:fechar`, `drive:restaurar`, `drive:status` | Comandos de `drive.mjs`. |
| `whatsapp:ligar`, `whatsapp:parar` | Cria o banco `evolution` (se não existir) e liga/para o contêiner da Evolution. |

### `atualizar.mjs`

| Função | O que faz |
| --- | --- |
| `versaoNoGitHub()` | Último commit do ramo `VISTORIA_RAMO` (padrão `consulta-placa`) do repositório `fpcportela/VISTORIAECV`, pela API pública do GitHub (sem token). |
| `baixar(sha)` | Baixa o zip desse commit (`codeload.github.com`) e descompacta (`unzip` no Mac, `tar` no Windows). |
| `guardarAnterior()` | Copia a pasta atual (sem `node_modules`) para `~/.vistoria-ecv/versao-anterior`. |
| `limpar(pasta)` | Apaga o código antigo, menos `.env`, `node_modules`, `backups-automaticos`, `.versao`, `.git`, `.DS_Store` (em qualquer nível). |
| `atualizarBanco()` | Espera o banco responder e roda, em ordem, os arquivos `db/02-*.sql` e `db/05-*.sql` em diante pelo `psql` dentro do contêiner (lendo os arquivos da pasta do app, não da pasta montada). |
| `main()` | Compara o commit com o arquivo `.versao`; se for novo e o sistema não estiver aberto (porta 3001 livre), troca os arquivos, roda `npm run instalar` e `atualizarBanco()`. Se a troca falhar, volta a versão anterior. `--forcar` reinstala mesmo sem versão nova. |

### `drive.mjs`

| Comando / função | O que faz |
| --- | --- |
| `acharDrive()` | Pasta `Meu Drive/Vistoria ECV - backups` (ou `My Drive`). No Mac procura em `~/Library/CloudStorage/GoogleDrive*`; no Windows tenta as letras de unidade. `VISTORIA_DRIVE_PASTA` troca o caminho. |
| `travar()` | Lê `em-uso.json`. Se outro computador está marcado como usando, avisa e só continua se a pessoa digitar SIM. Grava a trava com o nome da máquina (`VISTORIA_MAQUINA` ou o nome do computador). |
| `restaurar()` | Usa `ultimo.json` (espera até 3 minutos o Drive baixar o arquivo com o tamanho certo). Se este computador já está com esse arquivo, não faz nada. Se o backup veio de versão mais nova do sistema, pede SIM. Antes de restaurar, guarda o banco local em `~/.vistoria-ecv/antes-de-restaurar` (fica com os 5 últimos). Restaura com `pg_restore --clean --single-transaction` e depois roda `atualizar.mjs --banco`. |
| `salvar()` | `pg_dump` numa pasta temporária, copia para o Drive como `.parcial` e renomeia (para o Drive não subir arquivo pela metade), atualiza `ultimo.json` (arquivo, tamanho, máquina, hora, versão do banco) e mantém os 20 backups mais novos. |
| `iniciar` | `abrir` + liga o app + abre `http://localhost:5173` + salva a cada 60 minutos. No Ctrl+C (ou se o app cair), espera, salva e libera a trava ("Liberado"). |
| `abrir`, `salvar`, `fechar`, `restaurar`, `status` | Partes soltas, para uso manual. `restaurar` força a restauração. |

Estado local: `~/.vistoria-ecv/sincronizacao.json` (último arquivo restaurado ou salvo).

## Dependências

- **Depende de:** Docker Desktop, Node.js, Google Drive para computador (sincronizando a pasta), acesso à internet para o GitHub. Usa os arquivos de `db/` ([arquitetura](../arquitetura.md)).
- **Quem depende dele:** o uso diário do sistema nos dois computadores. [backup-e-recuperacao](backup-e-recuperacao.md) é independente (a tela faz o próprio backup).

## Tabelas usadas

Todas (backup e restauração do banco `vistoria_ecv` inteiro).

## Regras de negócio e casos especiais

- **Um computador de cada vez.** A trava `em-uso.json` avisa, mas não impede: a pessoa pode digitar SIM e abrir mesmo assim.
- O "mais novo" é decidido pelo `ultimo.json` (último que salvou), não pela data dos arquivos.
- A versão do banco é o nome do último `db/NN-*.sql`; serve para avisar quando o backup veio de um sistema mais novo.
- Atualização com o sistema aberto (porta 3001 em uso) é adiada para a próxima abertura.
- `db/01-schema.sql`, `db/03-dados-iniciais.sql` e `db/04-usuario-app.sh` só rodam quando o banco é criado do zero (pasta montada em `/docker-entrypoint-initdb.d`). As outras migrações rodam em toda atualização e foram escritas para poder rodar de novo.
- O WhatsApp por QR code só é ligado pelo atalho fora do Windows e quando há `EVOLUTION_API_KEY` no `.env` da raiz.

## Pontos frágeis, TODOs e dívidas técnicas

- **Conflito entre computadores:** se os dois forem usados ao mesmo tempo (ou se o Drive não sincronizar a tempo), o que foi feito em um deles se perde na próxima restauração. Não há combinação automática; dá para usar a importação "combinar" da tela [backup-e-recuperacao](backup-e-recuperacao.md) com o arquivo guardado em `antes-de-restaurar`.
- Se o computador desligar sem o Ctrl+C, a trava fica no Drive e o último backup pode ser de até 60 minutos antes.
- A atualização usa a API do GitHub **sem autenticação**: funciona só se o repositório for público e está sujeita ao limite de consultas sem login. ⚠️ verificar se o repositório é público.
- A atualização sempre segue o ramo `consulta-placa` (a não ser que `VISTORIA_RAMO` mude): qualquer commit nesse ramo chega aos computadores na próxima abertura, sem revisão.
- Se uma migração falhar no meio de `atualizarBanco()`, o código novo já foi instalado e o banco fica com parte das mudanças; o `abrir.mjs` não para por causa disso (não confere o código de saída de `atualizar.mjs`).
- A comparação de versão do banco é por texto (`'40-...' > '39-...'`); passa a errar quando houver migração com três dígitos.
- O banco `evolution` (sessão do WhatsApp por QR code) e o volume `whatsapp_sessoes` não entram no backup do Drive. ⚠️ verificar se o QR code precisa ser lido de novo ao trocar de computador.
- Senhas padrão do banco no `docker-compose.yml` (`vistoria_dev`, `app_dev`) quando o `.env` não informa outras; a porta 5432 fica aberta em todas as interfaces.
