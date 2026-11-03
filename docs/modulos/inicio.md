# Módulo: Início (tela principal, menu e pesquisa)

## Objetivo

Tela que o usuário vê depois do login e que contém todas as outras: menu lateral com os módulos liberados, seletor de grupo (master) e de loja, pesquisa geral do topo, cor do tema e o painel "Visão geral" com os números do dia e do mês (vistorias vendidas, vendas em aberto, contas a receber e a pagar, royalties).

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `web/src/App.jsx` | Decide entre `Login` e `Inicio`; carrega o perfil (`/api/eu`) e aplica a cor. |
| `web/src/Inicio.jsx` | Casca do sistema: menu, topo, troca de telas, abas de venda, painel "Visão geral", paleta de cores, contadores do WhatsApp no menu. |
| `web/src/modulos.js` | `MODULOS` (itens do menu e a permissão de cada um), `criarTem`, `ordenar`. |
| `web/src/Pesquisa.jsx` | Pesquisa do topo: clientes, vendas e vistorias; com placa completa, oferece a consulta na API Placas. |
| `web/src/EditorAtalhos.jsx` | Janela para escolher e ordenar itens; hoje usada só em "Organizar menu" (`soOrdem`). |
| `web/src/tema.js` | `COR_PADRAO` (#0774B8), `PALETA` (8 cores), `aplicarTema(cor)`: gera os tons do sistema a partir de uma cor. |
| `api/src/index.js` | `GET /api/eu`, `PUT /api/atalhos`, `PUT /api/menu`, `PUT /api/tema`, `GET /api/inicio`. |
| `api/src/vendas.js` | `GET /api/busca` (pesquisa geral). |
| `db/02-acessos.sql` | `usuario_atalhos`, `app_meus_atalhos`, `app_salvar_atalhos`, `app_meu_menu`, `app_salvar_menu`. |
| `db/02-login.sql`, `db/22-cor-por-grupo.sql` | Cor do tema (`app_cor_tema`, `app_salvar_cor_tema`, `app_pode_cor_tema`, `app_grupo_da_cor`). |

## Funções e rotas públicas

| Rota / função | O que faz |
| --- | --- |
| `GET /api/eu` | Perfil: usuário, lojas (`app_minhas_lojas`), cor do tema e se pode mudar, atalhos, ordem do menu, permissões por loja (`app_meus_acessos`), grupos visíveis (master vê todos), grupo escolhido e logo do grupo. |
| `GET /api/inicio?loja=` | Números do painel, só das lojas em que a pessoa tem a permissão de cada parte: contas a receber/pagar (`resumo_contas`, `financeiro.ver`), vistorias vendidas hoje e no mês por tipo de veículo (`vendas.ver`), vendas `aberta` e `futuro` (qualquer data), royalties do mês (`apuracoes_royalty`, `royalties.ver`). |
| `PUT /api/menu` | Grava a ordem do menu (até 40 itens). |
| `PUT /api/atalhos` | Grava os atalhos (até 30). |
| `PUT /api/tema` | Grava a cor (`#rrggbb`). Com grupo escolhido, vale para o grupo todo; sem grupo, só para a pessoa (texto da paleta). |
| `GET /api/busca?q=&loja=` | A partir de 2 caracteres: até 8 clientes (nome ou começo do CPF/CNPJ, sem o avulso), 8 vistorias e 8 vendas (cliente, documento ou placa com 3+ caracteres). Devolve também a placa normalizada. |
| `criarTem(perfil, loja)` | Função `tem(permissao)` do front: master pode tudo; com loja escolhida, olha só aquela loja; em "Todas as lojas", basta ter em uma. Aceita lista (basta uma). |
| `ordenar(modulos, ordem)` | Menu na ordem salva; itens fora da lista vão para o fim. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md) (perfil, permissões, cor), [financeiro](financeiro.md) (`resumo_contas`), [vendas](vendas.md), [servicos](servicos.md) (`gera_vistoria`), [consulta-placa-e-fipe](consulta-placa-e-fipe.md), [whatsapp-e-robo](whatsapp-e-robo.md) (contadores), [grupos-e-unidades](grupos-e-unidades.md) (logo, grupo escolhido), [interface-comum](interface-comum.md) (`api.js`, ícones, estilo). Royalties: só a tabela `apuracoes_royalty` (ver [arquitetura](../arquitetura.md)).
- **Quem depende dele:** todas as telas são abertas a partir de `Inicio.jsx`.

## Tabelas usadas

`resumo_contas` (view), `vendas`, `venda_itens`, `servicos`, `veiculos`, `apuracoes_royalty`, `usuario_atalhos`, `usuarios`, `empresas`, `lojas`, `clientes`, `vistorias`.

## Regras de negócio e casos especiais

- **"Vistorias vendidas"**: a vistoria é feita no sistema do Detran, então o painel conta itens de serviços com `gera_vistoria` em vendas `finalizada` do tipo `venda_avulsa`, por tipo de veículo do item (carro, moto, caminhão). O mês zera sozinho na virada.
- Os cartões "Vendas abertas" e "Agendadas" abrem a lista de vendas já filtrada (`aberta` / `futuro`).
- Cada venda abre numa **aba** própria dentro da tela de vendas; uma venda já aberta volta para a aba dela; fechar uma venda nova sem salvar pede confirmação.
- O master escolhe o grupo no topo (ou "Todos os grupos"). Trocar o grupo **recarrega a página**; se houver venda nova não salva, pede confirmação.
- Botão "Ocultar valores" esconde os valores do painel.
- O menu mostra só os módulos liberados (`MODULOS` + permissões). O item "Vistorias" está fora da lista (módulo oculto, ver [vistorias](vistorias.md)).
- Contadores do WhatsApp no menu: não lidas e chamados em aberto, consultados a cada 20 s quando a aba está visível.

## Pontos frágeis, TODOs e dívidas técnicas

- **Royalties** e **Maquininhas e bancos** estão no menu, mas abrir mostra "Este módulo será desenvolvido nas próximas etapas" (`emBreve`). O mesmo vale para o botão "Conectar" do painel de maquininhas e para o botão de ajuda.
- O painel "Royalties do mês" lê `apuracoes_royalty`, mas nada no código chama `calcular_royalty` (a função do banco que cria a apuração). Sem uma chamada manual no banco, o valor fica zerado. ⚠️ verificar se há apurações criadas fora do app.
- O seletor "Mostrar" (a receber e a pagar / só a receber / só a pagar) não tem efeito: não há `onChange`.
- `PUT /api/atalhos`, `app_meus_atalhos` e a coluna `usuario_atalhos.atalhos` continuam na API, mas a tela não mostra nem grava atalhos; `EditorAtalhos` só organiza o menu.
- `GET /api/busca` fica em `vendas.js` e ainda procura na tabela `vistorias` (módulo oculto).
- As abas de venda ficam montadas o tempo todo; muitas abas abertas pesam na tela.
- `Inicio.jsx` concentra a navegação de todas as telas (lista fixa de ids em `abrir`), então cada módulo novo precisa ser incluído ali.
