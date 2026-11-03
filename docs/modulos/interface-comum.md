# Módulo: Interface comum (front-end compartilhado)

## Objetivo

Peças do front-end usadas por todas as telas: chamada à API com o login, regras de digitação (maiúsculas, sem acento, valores em reais), campos de data e mês, máscaras de documentos, ícones, estilo, tema e o necessário para instalar o app no celular (PWA).

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `web/src/main.jsx` | Monta o React, carrega `estilo.css` e `entrada.js` e registra o service worker. |
| `web/src/App.jsx` | Login ou sistema; carrega o perfil e aplica a cor. |
| `web/src/api.js` | `api()`, `sessao`, `grupoEscolhido`, `moeda`. |
| `web/src/entrada.js` | Regras de digitação para o sistema inteiro; `semAcento`, `mascaraMoeda`, `paraMoeda`, `lerMoeda`. |
| `web/src/Data.jsx` | `CampoData` e `CampoMes` (digitação DD/MM/AAAA e MM/AAAA), `mascaraData`, `paraData`, `lerData`, `mascaraMes`, `paraMes`, `lerMes`. |
| `web/src/documentos.js` | `mascaraCpf`, `mascaraCnpj`, `formatarDoc`, `mascaraTelefone`, `cpfValido`, `cnpjValido`. |
| `web/src/icones.jsx` | `Icone({ nome, tamanho, traco })`: ícones em SVG desenhados no próprio código. |
| `web/src/tema.js` | `COR_PADRAO`, `PALETA`, `aplicarTema`: gera os tons (variáveis CSS) a partir de uma cor. |
| `web/src/estilo.css` | Estilo único do app (variáveis de cor em `:root`, botões, cartões, tabelas, telas; 26 blocos `@media` para celular). |
| `web/src/modulos.js` | Lista do menu e `criarTem` (ver [inicio](inicio.md)). |
| `web/index.html` | Página base: fonte Nunito Sans (Google Fonts), manifest, ícone. |
| `web/public/manifest.webmanifest`, `web/public/sw.js`, `web/public/icone.svg` | App instalável (PWA). O service worker é mínimo e não guarda nada para uso sem internet. |
| `web/vite.config.js` | Porta 5173 e repasse de `/api` para `http://localhost:3001`, em `dev` e em `preview`. |

## Funções e rotas públicas

| Função | O que faz |
| --- | --- |
| `api(caminho, { metodo, corpo })` | `fetch` em `/api` + caminho, com JSON, `Authorization: Bearer <token>` e `X-Grupo` (grupo escolhido pelo master). Resposta 401 apaga o token. Erro vira `Error` com `status` e a mensagem `erro` da API. |
| `sessao` | `token()`, `salvar(t)`, `sair()` no `localStorage` (`vistoria-ecv-token`). |
| `grupoEscolhido` | `ler()` / `salvar(id)` do grupo escolhido no topo (`vistoria-ecv-grupo`). |
| `moeda(v)` | Número no formato brasileiro com 2 casas (sem "R$"). |
| Ouvinte global de `input` (`entrada.js`) | Em todo campo de texto (`text`, `search`, `tel`, sem tipo) e `textarea`: converte para **MAIÚSCULAS sem acento**, a não ser que tenha `data-livre`. Com `data-moeda`, aplica a máscara de valor (digitar 15000 vira 150,00). Grava pelo setter nativo para o React enxergar no mesmo evento. |
| `CampoData` / `CampoMes` | Campos de data e mês com máscara; trabalham com o formato ISO (`AAAA-MM-DD`, `AAAA-MM`) por fora. |
| `aplicarTema(cor)` | Calcula as variáveis `--primaria`, `--forte`, `--clara`, `--sobre-primaria` etc. a partir da cor escolhida. |

## Dependências

- **Depende de:** React 18.3.1, Vite 5.4.21, jspdf 4.2.1 e jspdf-autotable 5.0.9 (PDFs), Google Fonts.
- **Quem depende dele:** todas as telas.

## Tabelas usadas

Nenhuma diretamente (a cor do tema vem de `/api/eu`).

## Regras de negócio e casos especiais

- Padrão do sistema: texto digitado fica em maiúsculas e sem acento. E-mail, senha e campos de data não são alterados (tipos diferentes de texto ou `data-livre`).
- Valores em reais são digitados só com números: os dois últimos dígitos são os centavos.
- O master escolhe o grupo no topo; o id vai em todo pedido no cabeçalho `X-Grupo`, e a API usa esse grupo para filtrar (ver [acesso-e-usuarios](acesso-e-usuarios.md)).

## Pontos frágeis, TODOs e dívidas técnicas

- O token de login fica no `localStorage`, acessível por qualquer script da página.
- `sessao` não protege o acesso ao `localStorage` com `try/catch` (o `grupoEscolhido` protege); em navegador que bloqueia o armazenamento, o login pode falhar ⚠️ verificar.
- O ouvinte global de `input` muda o comportamento de todos os campos; um campo novo que precise de minúsculas ou acento tem que lembrar de usar `data-livre`.
- O service worker não faz cache: sem internet ou com a API desligada, o app não abre.
- A fonte vem do Google Fonts; sem internet, cai na fonte do sistema.
- `vite preview --host` (usado por `npm run iniciar`) deixa o app acessível por outros aparelhos da rede local na porta 5173.
- Validação de CPF/CNPJ duplicada com a da API (`api/src/documentos.js`).
- Um único arquivo de estilo com mais de 1000 linhas.
