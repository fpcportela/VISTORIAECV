# Módulo: Colaboradores e controle de ponto

## Objetivo

- **Colaboradores:** cadastro dos funcionários de cada grupo (com ou sem login no sistema), as unidades em que trabalham, o cargo e os arquivos anexados (RG, CNH, contrato…).
- **Controle de ponto:** registro das quatro marcações do dia com foto (entrada, saída almoço, volta almoço, saída), espelho do mês, ajuste com motivo, justificativa com documentos, comprovante do dia em PDF enviado pelo WhatsApp e relatório do mês em PDF.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/pessoas.js` | Rotas `/api/colaboradores...`, `/api/tipos-arquivo...` e `/api/ponto/...`. |
| `api/src/comprovantePonto.js` | `comprovanteDoDia`: monta o comprovante (texto, hash SHA-256, PDF em formato de cupom), guarda e manda pelo WhatsApp. |
| `api/src/acessos.js` | Rotas `/api/cargos` (cargos ficam com usuários e permissões; ver [acesso-e-usuarios](acesso-e-usuarios.md)). |
| `web/src/Colaboradores.jsx` | Lista, `EditorColaborador` (com "Acessa sistema"), `Arquivos`, `TiposArquivo`. |
| `web/src/Ponto.jsx` | `Registrar` (escolhe o colaborador), `Camera` (câmera frontal), `Espelho` (mês), `FotoPonto`, `DetalheMarcacao` (ajuste), `Justificar`, `RelatorioPonto`. |
| `web/src/relatorioPonto.js` | PDF do relatório do mês no navegador (jspdf + jspdf-autotable). |
| `db/06-colaboradores-ponto.sql` | `colaboradores`, `tipos_arquivo`, `colaborador_arquivos`, `ponto_registros`, `ponto_justificativas`, auditoria `auditar_ponto` (sem a foto), permissões, tipos de arquivo sugeridos. |
| `db/13-cargos-unidades-colaborador.sql` | `cargos`, `colaborador_lojas` (várias unidades), `pode_colaborador`. |
| `db/15-acesso-colaborador-whatsapp.sql` | `app_colaborador_acesso`, `app_colaborador_ver_acesso` (login do colaborador). |
| `db/19-ponto-comprovante-anexos.sql` | `ponto_comprovantes`, `ponto_justificativa_arquivos`, `app_ponto_nsr`. |
| `db/20-usuario-colaborador.sql` | Usuário e colaborador ligados (mudança num passa para o outro); proíbe apagar usuários e colaboradores. |
| `db/31-justificativa-por-marcacao.sql` | Justificativa por marcação ou do dia todo. |

## Funções e rotas públicas

### Colaboradores

| Rota | O que faz |
| --- | --- |
| `GET /api/colaboradores?loja=&busca=&inativos=1` | Lista (nome ou CPF), com unidades e quantidade de arquivos. Exige `colaboradores.ver` ou `colaboradores.editar` em alguma unidade do colaborador. |
| `GET /api/colaboradores/:id` | Cadastro, unidades, arquivos, se pode editar e o acesso ao sistema (usuário e perfil; a senha nunca volta). |
| `POST/PUT /api/colaboradores[/:id]` | Valida nome, CPF (sem repetir no grupo), celular (DDD + número), nascimento, unidades (todas do mesmo grupo, a primeira é a principal) e cargo. Com `acesso`, cria ou atualiza o login (senha de 6+ caracteres na criação) ou desativa. |
| `GET/POST/PUT/DELETE /api/tipos-arquivo` | Tipos de arquivo do grupo (nome único). |
| `POST /api/colaboradores/:id/arquivos?nome=&tipo=&mime=&obs=` | Anexa arquivo (corpo bruto, até 15 MB), guardado no banco. |
| `GET/DELETE /api/colaboradores/:id/arquivos/:arq` | Abre ou exclui. |

### Ponto

| Rota | O que faz |
| --- | --- |
| `GET /api/ponto/colaboradores?loja=` | Colaboradores da unidade com as marcações de hoje. Exige `ponto.registrar` ou `ponto.ver_equipe`. |
| `POST /api/ponto/registrar` | Foto obrigatória (JPEG/PNG/WebP até 1,5 MB). Grava a **próxima** marcação que falta no dia, na ordem entrada → saída almoço → volta almoço → saída. Na saída final, gera e envia o comprovante depois de responder. |
| `GET /api/ponto/espelho?colaborador=&mes=` | Marcações (inclusive as inativas, substituídas por ajuste), justificativas com anexos, comprovantes e o que a pessoa pode fazer. Exige `ponto.ver_equipe`. |
| `GET /api/ponto/registros/:id/foto` | Foto da marcação (`ponto.ver_equipe`). |
| `POST /api/ponto/ajustar` | Inclui ou corrige uma marcação com hora e **motivo obrigatório**. A anterior fica inativa e a nova aponta para ela (`ajuste_de`), mantendo a foto. Exige `ponto.ajustar`. |
| `PUT /api/ponto/justificativa` | Justificativa de uma marcação ou do dia todo (sem tipo); texto vazio apaga. Exige `ponto.justificar`. |
| `POST/GET/DELETE /api/ponto/justificativa/arquivos...` | Documentos da justificativa (até 15 MB); precisa existir a justificativa antes. |
| `GET /api/ponto/comprovante?colaborador=&data=` | PDF do comprovante guardado. |
| `POST /api/ponto/comprovante/reenviar` | Gera e manda de novo (`ponto.ajustar`). |
| `GET /api/ponto/relatorio?loja=&mes=&colaborador=` | Dados do mês para o PDF (marcações ativas e justificativas); inclui inativos que tiveram marcação no mês. |

### Banco

| Função | O que faz |
| --- | --- |
| `pode_colaborador(colaborador, permissao)` | A pessoa tem a permissão em alguma unidade do colaborador? |
| `app_colaborador_acesso(...)`, `app_colaborador_ver_acesso(...)` | Cria/atualiza/desativa o login do colaborador; o "usuário" fica na coluna `usuarios.email` e pode ser um nome simples. |
| `colaborador_para_usuario()`, `usuario_para_colaborador()` (gatilhos) | Nome, CPF, celular e cargo mudam nos dois lados. Inativar o colaborador tira o acesso; tirar o acesso não inativa o colaborador. |
| `proibir_apagar()` (gatilho) | Usuários e colaboradores nunca são apagados, só inativados. |
| `app_ponto_nsr(loja)` | Próximo número do comprovante (NSR) do grupo (`proximo_numero(..., 'ponto_comprovante')`). |
| `app_colaboradores_para_usuario`, `app_ligar_colaborador_usuario`, `app_colaborador_do_usuario` | Ligar um colaborador a um usuário já existente (tela de usuários). |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md) (permissões, cargos, login), [grupos-e-unidades](grupos-e-unidades.md) (lojas, CNPJ, endereço e logo para comprovante e relatório), [whatsapp-e-robo](whatsapp-e-robo.md) (`enviarDocumento`, `numeroDoGrupo`), [clientes](clientes.md) (`cpfValido`).
- **Quem depende dele:** [acesso-e-usuarios](acesso-e-usuarios.md) (usuário ligado a colaborador), [inicio](inicio.md) (cartão "Ponto de hoje"). O PDF do mês (`relatorioPonto.js`) é aberto só pela tela de ponto.

## Tabelas usadas

`colaboradores`, `colaborador_lojas`, `colaborador_arquivos`, `tipos_arquivo`, `cargos`, `ponto_registros`, `ponto_justificativas`, `ponto_justificativa_arquivos`, `ponto_comprovantes`, `usuarios`, `lojas`, `empresas`, `whatsapp_numeros`. Auditoria em `ponto_registros` sem a foto (`auditar_ponto`).

## Regras de negócio e casos especiais

- No máximo **uma marcação ativa por tipo e dia** (índice único `ponto_registros_unico`). Depois das quatro, só pelo ajuste no espelho.
- O ponto fica na unidade em que foi batido, se o colaborador trabalha nela; senão, na unidade principal.
- Colaborador inativo não registra ponto.
- O dia do ponto é a data de São Paulo (`America/Sao_Paulo`).
- Ajuste nunca apaga: a marcação antiga fica `ativo = false` e o banco exige motivo em todo ajuste (`check`).
- Comprovante: NSR sequencial por grupo, hash SHA-256 do texto, PDF de 80 mm (cupom), horas trabalhadas calculadas (entrada→saída, menos o almoço). Situação do envio: `enviado`, `simulado` (modo teste do WhatsApp), `sem_celular`, `sem_whatsapp` (grupo sem número), `falhou`.
- Ao alterar as unidades de um colaborador, a pessoa só tira as unidades que ela mesma pode gerenciar; as outras ficam.
- O nome do cargo é gravado também no colaborador (`cargo`), para o ponto e os relatórios.
- Texto em maiúsculas (nome, cargo).

## Pontos frágeis, TODOs e dívidas técnicas

- Quem tem `ponto.registrar` registra o ponto de **qualquer** colaborador ativo da unidade (escolhe na lista e tira a foto). Não há conferência de que a pessoa da foto é o colaborador.
- A câmera só funciona em contexto seguro (HTTPS ou `localhost`), conforme `window.isSecureContext` em `Ponto.jsx`.
- Fotos, arquivos dos colaboradores, anexos de justificativa e PDFs dos comprovantes ficam no banco (`bytea`), o que aumenta os backups.
- O **reenvio** do comprovante gera um NSR novo e substitui o comprovante guardado (`on conflict ... do update`), então o número anterior se perde.
- O comprovante é gerado depois da resposta ao registro; se a API cair nesse meio-tempo, o comprovante não é criado (dá para reenviar).
- As tabelas antigas `jornadas` e `marcacoes_ponto` (`db/01`) e a política `ponto_ajuste` sobre `marcacoes_ponto` continuam no banco, mas o código usa só `ponto_registros`.
- `dataValida` existe também aqui (terceira cópia, junto com `vendas.js` e `financeiro.js`).
- O CPF do colaborador é opcional; o comprovante mostra "NÃO INFORMADO".
