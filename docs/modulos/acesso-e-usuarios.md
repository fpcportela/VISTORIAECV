# Módulo: Acesso e usuários

## Objetivo

Controlar quem entra no sistema e o que cada pessoa pode ver e fazer em cada loja (unidade):

- login com e-mail e senha (token JWT);
- "Esqueci a senha" com código pelo WhatsApp;
- usuários, perfis (conjunto de permissões), cargos e o vínculo usuário ↔ loja ↔ perfil;
- o usuário **master** (`usuarios.admin_rede = true`), que vê todos os grupos;
- a conexão com o banco "em nome do usuário", que faz valer as regras de acesso por loja (RLS).

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/index.js` | Sobe o Express, define `rota()` (tradução de erros do banco), `exigeLogin` (confere o JWT e lê o cabeçalho `X-Grupo`), `POST /api/login`, `GET /api/eu`, `PUT /api/atalhos`, `PUT /api/menu`, `PUT /api/tema`, e registra as rotas de todos os módulos. |
| `api/src/db.js` | Pool do PostgreSQL e `comoUsuario()`: abre a transação, grava `app.usuario_id`, `app.grupo` e o fuso `America/Sao_Paulo`. |
| `api/src/comum.js` | Peças comuns das rotas: `Recusa`, `exigir()`, `texto()`, `criarComRecusa()`, `resolverCliente()` (esta última é do módulo [clientes](clientes.md)). |
| `api/src/acessos.js` | Rotas de permissões, perfis, cargos e usuários. |
| `web/src/App.jsx` | Decide entre a tela de login e o sistema; carrega o perfil (`/api/eu`) e aplica a cor. |
| `web/src/Login.jsx` | Tela de login e o fluxo "Esqueci a senha" (2 etapas). |
| `web/src/UsuariosPermissoes.jsx` | Tela "Usuários e permissões": perfis, cargos e usuários. |
| `web/src/modulos.js` | Lista de módulos do menu, com a permissão de cada um; `criarTem()` e `ordenar()`. |
| `web/src/api.js` | `api()` (fetch com token e `X-Grupo`), `sessao` (token no `localStorage`), `grupoEscolhido`. |
| `db/01-schema.sql` (seções 2 e 12) | Tabelas `usuarios`, `permissoes`, `perfis`, `perfil_permissoes`, `usuario_lojas`; funções de RLS e catálogo inicial de permissões. |
| `db/02-login.sql`, `db/02-acessos.sql` | Funções de login, lojas do usuário, perfis, usuários, atalhos e menu. |
| `db/04-usuario-app.sh` | Cria o papel `app_api` (não é dono das tabelas, então a RLS vale para ele). |
| `db/05-atualizacao-perfis.sql` | Nível `consulta`/`uso` em cada permissão; CPF e celular no usuário. |
| `db/10-grupos.sql` | Nova versão de `tem_loja`, `tem_empresa`, `pode` levando em conta o grupo escolhido pelo master. |
| `db/13-cargos-unidades-colaborador.sql` | Tabela `cargos`, `app_definir_cargo`, `app_autorizar_permissao`. |
| `db/15-acesso-colaborador-whatsapp.sql` | `senha_codigos`, `app_senha_pedir_codigo`, `app_senha_redefinir` e nova versão de `app_login`. |
| `db/20-usuario-colaborador.sql` | Usuário e colaborador sincronizados; proíbe apagar usuários e colaboradores. |

## Funções e rotas públicas

### API (Node)

| Função / rota | O que faz |
| --- | --- |
| `comoUsuario(usuarioId, fn)` (`db.js`) | Roda `fn(db)` numa transação com `app.usuario_id`, `app.grupo` (do `AsyncLocalStorage` `contexto`) e fuso de São Paulo. Faz `rollback` em caso de erro. |
| `contexto` (`db.js`) | `AsyncLocalStorage` com o grupo escolhido pelo master (cabeçalho `X-Grupo`). |
| `rota(fn)` (`index.js`) | Envolve o handler: erro `42501` → 403, `23505` → 400 ("Já existe um cadastro…"), `22023`/`23503` → 400 com a mensagem do banco; o resto → 500. |
| `exigeLogin` (`index.js`) | Lê `Authorization: Bearer`, valida o JWT (`sub` = id do usuário) e guarda o `X-Grupo` (se for UUID) no `contexto`. |
| `Recusa`, `exigir(db, loja, permissao, msg)`, `criarComRecusa(rota)`, `texto(v, max)` (`comum.js`) | Erro com status HTTP; checagem de permissão via `pode()`; wrapper que transforma `Recusa` em `{ erro }`; limpeza de texto. |
| `POST /api/login` | Chama `app_login(email, senha)`; devolve `{ token }` com validade de **12 h**. |
| `GET /api/eu` | Devolve usuário, lojas, cor do tema, se pode mudar a cor, atalhos, ordem do menu, permissões por loja, grupos visíveis, grupo ativo, logo e se é master. |
| `PUT /api/atalhos`, `PUT /api/menu`, `PUT /api/tema` | Salvam atalhos (até 30), ordem do menu (até 40) e cor (`#RRGGBB`). |
| `GET /api/permissoes` | Catálogo de permissões (`codigo`, `modulo`, `descricao`, `nivel`). |
| `GET/POST/PUT/DELETE /api/perfis` | Lista (`app_perfis`), cria/altera (`app_salvar_perfil`) e exclui (`app_excluir_perfil`). |
| `GET/POST/PUT /api/cargos` | Lista cargos com o número de usos; cria/altera cargo (nome em maiúsculas, único por grupo, perfil sugerido do mesmo grupo). |
| `GET/POST/PUT /api/usuarios` | Lista (`app_usuarios` + cargo + colaborador ligado) e salva (`app_salvar_usuario`, `app_definir_cargo`, `app_ligar_colaborador_usuario`). Valida CPF e celular (10 ou 11 dígitos). |
| `GET /api/usuarios/colaboradores?busca=` | Busca colaboradores para preencher o cadastro do usuário (`app_colaboradores_para_usuario`). |
| `POST /api/senha/codigo`, `POST /api/senha/redefinir` | Ficam em `api/src/whatsapp.js` (ver [whatsapp-e-robo](whatsapp-e-robo.md)); usam `app_senha_pedir_codigo` e `app_senha_redefinir`. |

### Front (React)

| Componente / função | O que faz |
| --- | --- |
| `App` | Mostra "Carregando…", `Login` ou `Inicio`. Sair apaga o token e volta a cor padrão. |
| `Login`, `EsqueciSenha` | Login; código de 6 números pelo WhatsApp, válido por 15 min; senha nova com no mínimo 6 caracteres. |
| `UsuariosPermissoes` e editores `EditorPerfil`, `EditorCargo`, `EditorUsuario` | Cadastro de perfis (consulta/uso por módulo), cargos e usuários (filiais e o perfil de cada uma). |
| `MODULOS`, `criarTem(perfil, loja)`, `ordenar(modulos, ordem)` (`modulos.js`) | Lista do menu; `tem(permissao)` olha a loja escolhida ou qualquer loja ("Todas as lojas"); o master sempre tem. |
| `api()`, `sessao`, `grupoEscolhido` (`api.js`) | Chamada à API; resposta 401 apaga o token. |

### Banco (funções SQL)

| Função | O que faz |
| --- | --- |
| `app_usuario_atual()` | Lê `app.usuario_id` da transação. |
| `grupo_ativo()` | Lê `app.grupo` (grupo escolhido pelo master). |
| `eh_admin_rede()` | O usuário atual é master? |
| `tem_loja(loja)`, `tem_empresa(empresa)` | Acesso à loja/grupo. Master: tudo, ou só o grupo ativo se houver um escolhido. Demais: pelos vínculos ativos em `usuario_lojas`. |
| `pode(loja, permissao)` | O perfil do usuário naquela loja tem a permissão? Master: sempre (dentro do grupo ativo). |
| `app_login(email, senha)` | Confere e-mail (sem diferenciar maiúsculas) e senha bcrypt de usuário ativo. |
| `app_minhas_lojas()` | Lojas ativas que o usuário vê. |
| `app_meus_acessos()` | Pares (loja, permissão) do usuário; o master recebe todas as permissões em todas as lojas ativas. |
| `gerencia_empresa`, `consulta_empresa`, `ve_usuarios_loja` | Quem pode alterar ou só ver usuários/perfis de um grupo ou loja. |
| `app_perfis`, `app_salvar_perfil`, `app_excluir_perfil` | Perfis visíveis; salvar redefine exatamente a lista de permissões; não exclui perfil em uso. |
| `app_usuarios`, `app_salvar_usuario` | Lista e salva usuários e vínculos (loja + perfil). |
| `app_definir_cargo`, `app_cargos_usuarios` | Cargo do usuário. |
| `app_autorizar_permissao(loja, email, senha, permissao)` | Confere e-mail e senha de quem autoriza uma ação (master ou perfil com a permissão na loja). Usado por desconto, preço e troca de unidade na venda. |
| `app_meus_atalhos`, `app_salvar_atalhos`, `app_meu_menu`, `app_salvar_menu` | Atalhos da tela inicial e ordem do menu (tabela `usuario_atalhos`). |
| `app_senha_pedir_codigo`, `app_senha_redefinir` | Código de recuperação (hash bcrypt, 15 min, máximo 5 tentativas, no máximo um pedido por minuto). |
| `app_colaboradores_para_usuario`, `app_ligar_colaborador_usuario`, `app_colaborador_do_usuario` | Ligação usuário ↔ colaborador. |
| `proibir_apagar()` (gatilho) | Impede `DELETE` em `usuarios` e `colaboradores`. |
| `colaborador_para_usuario()`, `usuario_para_colaborador()` (gatilhos) | Copiam nome, CPF, celular e cargo de um cadastro para o outro. |

## Dependências

- **Depende de:** PostgreSQL (`pgcrypto` para `crypt`/`gen_salt('bf')`), `jsonwebtoken`, `express`, `pg`. O "Esqueci a senha" depende do módulo [whatsapp-e-robo](whatsapp-e-robo.md) para mandar o código. A ligação com colaborador depende de [colaboradores-e-ponto](colaboradores-e-ponto.md).
- **Quem depende dele:** todos os módulos. Toda rota protegida usa `exigeLogin` e `comoUsuario`, e toda checagem de permissão usa `pode()` ou `exigir()`.

## Tabelas usadas

`usuarios`, `permissoes`, `perfis`, `perfil_permissoes`, `usuario_lojas`, `cargos`, `usuario_atalhos`, `preferencias_tema`, `senha_codigos`, `colaboradores` (ligação), `lojas`, `empresas`.

## Regras de negócio e casos especiais

- **Master:** `usuarios.admin_rede = true`. Vê todos os grupos e escolhe um no topo da tela; o front manda esse grupo no cabeçalho `X-Grupo`. Para quem não é master o cabeçalho é ignorado pelo banco.
- **Permissões por loja:** um usuário pode trabalhar em várias lojas, com um perfil diferente em cada uma (`usuario_lojas`).
- **Consulta x uso:** cada permissão tem `nivel` (`consulta` ou `uso`). Na tela, marcar um "uso" marca junto a "consulta" do módulo, e desmarcar a consulta tira o uso. A exceção é "Controle de ponto", onde bater o próprio ponto não exige ver o da equipe.
- O módulo "Vistorias" não aparece no editor de perfis (`OCULTOS`), mas as permissões já marcadas nele continuam salvas.
- Um usuário novo precisa de senha com 6 ou mais caracteres e de pelo menos uma loja (menos o master). E-mail e CPF não podem repetir.
- Quem não é master só altera usuários das lojas que gerencia (`usuarios.gerenciar`) e nunca altera um master. Ao salvar, só os vínculos das lojas que quem salva gerencia são trocados.
- O perfil escolhido precisa ser do mesmo grupo da loja. Um perfil em uso não pode ser excluído.
- Usuários e colaboradores **nunca são apagados**, só inativados (gatilho `proibir_apagar`). Inativar o colaborador tira o acesso do usuário ligado; o contrário não acontece.
- O código de "Esqueci a senha" só é gerado se o usuário tiver celular (o do usuário ou o do colaborador ligado), com no máximo um pedido por minuto.
- O "hoje" e o mês de todas as consultas são os de São Paulo (`set local time zone` em `comoUsuario`).

## Pontos frágeis, TODOs e dívidas técnicas

- `JWT_SECRET` tem um valor padrão no código (`'troque-este-segredo-em-producao'`) e o `api/.env.exemplo` traz `troque-este-segredo`. Se o `.env` não for ajustado, o segredo é conhecido.
- O token fica no `localStorage` e vale 12 h; não existe renovação nem lista de tokens revogados. Inativar um usuário não derruba um token já emitido: `exigeLogin` só valida a assinatura do JWT, e `tem_loja`/`pode` olham `usuario_lojas.ativo`, não `usuarios.ativo`. ⚠️ verificar se inativar o usuário também desliga os vínculos dele nas lojas.
- A tela de login diz "E-mail ou usuário" e `app_login` compara apenas com `usuarios.email`: o "usuário" do colaborador (`app_colaborador_acesso`, `db/15`) é gravado nesse campo `email`, mesmo quando não é um e-mail (3 a 80 caracteres `a-z0-9._@-`). A coluna chama `email`, mas guarda os dois.
- Em `acessos.js`, a rota de cargos usa `Object.assign(new Error(), { status })` em vez da classe `Recusa` usada nos outros arquivos (dois padrões para o mesmo fim).
- A mensagem do erro `23505` é genérica ("e-mail ou nome repetido") para qualquer violação de chave única.
- As permissões são criadas em vários arquivos (`01`, `05`, `06`, `08`, `23`, `40`). Não existe um lugar único com o catálogo completo.
- `app_cor_tema` e `app_salvar_cor_tema` existem em duas versões (`02-login.sql` e `22-cor-por-grupo.sql`); vale a do arquivo `22`, que roda depois.
