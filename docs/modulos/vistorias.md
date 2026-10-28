# Módulo: Vistorias (oculto)

## Objetivo

Abrir uma vistoria para um veículo, preencher o checklist (conforme / não conforme / não se aplica), concluir com um resultado ou cancelar.

O módulo está **oculto**: segundo o comentário em `web/src/modulos.js`, "a vistoria é feita no sistema obrigatório do Detran; aqui ficam só as vendas. As telas continuam no código (Vistorias.jsx) se voltar." A API e as tabelas continuam ativas.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/vistorias.js` | Rotas `/api/vistorias...`. |
| `web/src/Vistorias.jsx` | `ListaVistorias`, `NovaVistoria`, `ExecutarVistoria` e a constante `TIPOS` (tipos de veículo), que outras telas importam. |
| `db/01-schema.sql` (seção 5) | `checklist_modelos`, `checklist_modelo_itens`, `vistorias`, `vistoria_itens`, `vistoria_fotos`. |
| `db/03-dados-iniciais.sql` | Checklist de exemplo. |

## Funções e rotas públicas

| Rota | O que faz |
| --- | --- |
| `GET /api/vistorias?loja=&status=&periodo=&busca=` | Até 200 vistorias. `periodo`: `hoje` ou `mes`; `busca`: placa, cliente ou número. Exige `vistorias.ver`. |
| `POST /api/vistorias` | Abre a vistoria já "em andamento", com quem abriu como vistoriador. Grava ou completa o veículo (sem apagar marca/modelo já guardados), acha ou cria o cliente (`resolverCliente`), confere o serviço e copia o checklist do tipo do veículo (ou o geral do grupo). Exige `vistorias.criar`. |
| `GET /api/vistorias/:id` | Vistoria com loja, serviço, vistoriador, cliente, veículo, preço do serviço para o tipo do veículo, itens e permissões. |
| `PUT /api/vistorias/:id` | Salva km, parecer e a situação/observação de cada item. Só em vistoria `agendada` ou `em_andamento`. |
| `POST /api/vistorias/:id/concluir` | Exige `vistorias.concluir`, um resultado (`aprovado`, `aprovado_com_apontamentos`, `reprovado`) e todos os itens respondidos. |
| `POST /api/vistorias/:id/cancelar` | Exige `vistorias.cancelar`. Concluída não pode ser cancelada; o motivo vai para o parecer. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md), [clientes](clientes.md) (`resolverCliente`), [servicos](servicos.md), [consulta-placa-e-fipe](consulta-placa-e-fipe.md) (`normalizarPlaca`, `veiculos`).
- **Quem depende dele:** [servicos](servicos.md) e `Veiculo.jsx` (importam `TIPOS`), [inicio](inicio.md) (importa as telas; a pesquisa do topo ainda procura vistorias e abre uma vistoria encontrada).

## Tabelas usadas

`vistorias`, `vistoria_itens`, `checklist_modelos`, `checklist_modelo_itens`, `veiculos`, `clientes`, `servicos`, `servico_precos`, `lojas`, `usuarios`.

## Regras de negócio e casos especiais

- Status: `agendada`, `em_andamento`, `concluida`, `cancelada`. A API sempre cria como `em_andamento`.
- A API grava o número como 0; o gatilho `trg_vistorias_numero` (`numerar_por_grupo('vistoria')`) dá o número definitivo, sequencial por grupo, como nas vendas.
- O checklist é copiado para a vistoria; mudar o modelo depois não muda vistorias já abertas.

## Pontos frágeis, TODOs e dívidas técnicas

- O módulo não aparece no menu, mas a API responde e a pesquisa do topo ainda mostra vistorias.
- Não há tela nem rota para cadastrar modelos de checklist; só o exemplo de `db/03`.
- `vistoria_fotos` e `checklist_modelo_itens.exige_foto` existem, mas não há envio de foto (a tela só mostra "· foto" ao lado do item).
- `TIPOS` (tipos de veículo) mora neste módulo oculto e é importado por telas ativas ([servicos](servicos.md) e `Veiculo.jsx`).
- O painel do [inicio](inicio.md) conta "vistorias vendidas" pelas vendas, não por esta tabela.
