# Módulo: Backup e recuperação (tela Configurações)

## Objetivo

Dar ao master um backup completo do banco (todas as lojas, vendas, financeiro, fotos do ponto e arquivos) e a volta de um backup, de dois jeitos: **sobrescrever** o banco inteiro ou **combinar** o arquivo com o banco atual, registro por registro, escolhendo o que fazer com cada diferença.

A cópia automática para o Google Drive ao abrir e fechar o sistema é outro mecanismo, feito pelos scripts de inicialização (ver [inicializacao-e-sincronizacao](inicializacao-e-sincronizacao.md)).

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/backup.js` | `rodarDump()` (roda o `pg_dump`) e a rota `GET /api/backup`. |
| `api/src/recuperacao.js` | Rotas `/api/backup/importar/analisar` e `/aplicar`: leitura do arquivo, comparação, sobrescrever ou combinar. |
| `web/src/Configuracoes.jsx` | Tela "Configurações": `Backup` (gera e salva numa pasta escolhida) e `Importar` (envia o arquivo, mostra a análise e aplica). Para quem não é master: "Nenhuma configuração disponível para o seu perfil". |

## Funções e rotas públicas

| Rota / função | O que faz |
| --- | --- |
| `rodarDump()` | Roda `BACKUP_CMD` (padrão `docker exec vistoria-ecv-banco pg_dump -U vistoria -Fc vistoria_ecv`) e devolve o arquivo em memória. |
| `GET /api/backup` | Só master (`eh_admin_rede()`). Devolve o `.dump` (formato custom do `pg_dump`). |
| `POST /api/backup/importar/analisar` | Só master. Recebe o arquivo (até 1 GB, precisa começar com `PGDMP` e ter `lojas` e `usuarios`). Converte o arquivo e o banco atual em texto (`pg_restore --data-only`), compara tabela por tabela pela chave primária e devolve, por tabela, quantos registros são novos, iguais e diferentes (até 300 exemplos de cada, com os campos que mudaram). Nada é gravado. A análise fica guardada por 1 hora. |
| `POST /api/backup/importar/aplicar` | Só master. **Sempre guarda antes um backup automático** do banco atual em `BACKUP_DIR` (padrão `api/backups-automaticos`, fora do git); se não conseguir, não muda nada. Modo `sobrescrever`: exige digitar "SOBRESCREVER" e roda `pg_restore --clean --single-transaction`. Modo combinar: monta um SQL e roda numa transação com `psql -1`. |
| `lerCopias`, `literal`, `comparar`, `chavesPrimarias`, `guardarAutomatico` (internas) | Leitura dos blocos `COPY`, conversão para SQL, comparação e busca das chaves primárias no catálogo do PostgreSQL. |

Comandos configuráveis no `api/.env`: `BACKUP_CMD`, `BACKUP_TEXTO_CMD`, `BACKUP_RESTAURAR_CMD`, `BACKUP_PSQL_CMD`, `BACKUP_DIR`.

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md) (`eh_admin_rede`), Docker com o contêiner `vistoria-ecv-banco` (ou os comandos trocados no `.env`).
- **Quem depende dele:** ninguém no código da API. Os scripts de [inicializacao-e-sincronizacao](inicializacao-e-sincronizacao.md) fazem o próprio `pg_dump`/`pg_restore`, sem passar por estas rotas.

## Tabelas usadas

Todas as tabelas do esquema `public` (o backup é do banco inteiro). Regras especiais na combinação: `senha_codigos` (ignorada), `auditoria` e `venda_historico` (históricos), `contadores` (numeração).

## Regras de negócio e casos especiais

- **Backup na tela:** com navegador que permite escolher pasta (`showDirectoryPicker`), o arquivo vai para a pasta escolhida (do computador ou sincronizada com o Google Drive), que fica lembrada no navegador (IndexedDB). Nome: `vistoria-ecv_backup_DD-MM-AAAA_HHhMMmSSs.dump`; se já existir, ganha `-2`, `-3`… (nunca substitui). Sem essa função, o arquivo vai para os downloads.
- **Combinar**, para cada registro:
  - novo (a chave não existe no banco) → entra (`on conflict do nothing`);
  - igual ou diferente → a pessoa escolhe por tabela ou por registro: **subscreve** (fica o do arquivo), **mantém** (padrão) ou **apaga**.
- Tabelas de histórico (`auditoria`, `venda_historico`) são comparadas por todas as colunas menos o `id`; o que não existir igual entra com id novo; "iguais" não aparecem.
- `contadores` (numeração das vendas etc.) nunca volta para trás: fica o maior valor.
- Durante a combinação os gatilhos ficam desligados (`session_replication_role = replica`); depois, as sequências são ajustadas para o maior id. As exclusões rodam no fim, cada uma protegida: o que não puder ser apagado (por exemplo, por chave estrangeira) é contado e listado como "não apagado".
- Só entram na comparação as colunas que existem nas duas versões (o arquivo pode ser de uma versão antiga do sistema). Tabela que não existe mais no banco aparece como "ausente" e é pulada.

## Pontos frágeis, TODOs e dívidas técnicas

- O backup, o arquivo enviado e o texto das duas versões do banco ficam **inteiros na memória** da API durante a análise. Com o banco grande (fotos e arquivos ficam no banco), isso pode estourar a memória.
- As análises ficam na memória do processo (`Map`) e o arquivo numa pasta temporária: reiniciar a API perde a análise ("A análise venceu").
- Os comandos são divididos por espaço (`split(/\s+/)`), então caminhos com espaço no `.env` não funcionam.
- Gatilhos desligados na combinação: a auditoria e as regras feitas por gatilho (travas de venda, saldo do financeiro, etc.) **não rodam** para os registros importados. Por exemplo, `lancamentos.valor_pago` vem como está no arquivo, sem recalcular pelas baixas.
- Os comandos padrão dependem do Docker e do nome do contêiner `vistoria-ecv-banco`.
- Os backups automáticos em `api/backups-automaticos` não são apagados pelo sistema.
- O SQL da combinação é montado como texto, com escape próprio (`literal`, `ident`). Só o master usa, mas qualquer falha no escape pode quebrar a importação. ⚠️ verificar com um arquivo que tenha textos com barras e aspas.
