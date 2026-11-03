# Módulo: Serviços e produtos

## Objetivo

Cadastrar os serviços (ex.: ECV, CAUTELAR) e produtos (ex.: SEGUNDA VIA DE LAUDO) que a loja vende, com o valor padrão e o preço por tipo de veículo (carro, moto, caminhão, outro). O cadastro vale para todas as lojas do grupo.

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/vendas.js` (início do arquivo) | Rotas `GET/POST/PUT /api/servicos` e a consulta `SQL_SERVICOS`. Não existe um arquivo `servicos.js` próprio. |
| `web/src/Servicos.jsx` | Tela "Serviços e produtos": lista e editor. |
| `db/01-schema.sql` (seção 5) | Tabelas `servicos` e `servico_precos`. |
| `db/03-dados-iniciais.sql` | Serviços de exemplo e preços por tipo de veículo. |

## Funções e rotas públicas

| Função / rota | O que faz |
| --- | --- |
| `GET /api/servicos?loja=&uso=` | Lista os serviços do grupo da loja com `precos` (`{ tipo_veiculo: valor }`). `uso=vistoria` (padrão): só ativos, tipo serviço e que geram vistoria. `uso=venda`: só ativos. `uso=cadastro`: todos. |
| `POST /api/servicos`, `PUT /api/servicos/:id` | Cria ou altera. Nome em maiúsculas (até 80), tipo `servico` ou `produto`, valor padrão, descrição, `gera_vistoria`, `ativo`. Apaga e grava de novo os preços **gerais** (`loja_id` nulo) por tipo de veículo. Exige `servicos.gerenciar`. |
| `SQL_SERVICOS` | Para cada serviço, pega o preço de cada tipo de veículo; o preço da loja vale mais que o geral (`order by p.loja_id nulls last`). |
| `Servicos({ loja, podeEditar })` (front) | Lista e edita. Usa `TIPOS` importado de `Vistorias.jsx`. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md) (`exigir`, `pode`), `web/src/Vistorias.jsx` (constante `TIPOS`), `web/src/entrada.js` (`paraMoeda`).
- **Quem depende dele:** [vendas](vendas.md) (itens e preço travado), [clientes](clientes.md) (preço especial por serviço), [whatsapp-e-robo](whatsapp-e-robo.md) (serviço escolhido na conversa), [inicio](inicio.md) (contadores usam `gera_vistoria`), royalties no banco (`regras_royalty.servico_id`, ver [arquitetura](../arquitetura.md)).

## Tabelas usadas

`servicos`, `servico_precos`, `lojas` (para achar o grupo). A tabela `servicos` tem gatilho de auditoria (`aud_servicos`).

## Regras de negócio e casos especiais

- O serviço é do **grupo** (`servicos.empresa_id`); o nome não repete dentro do grupo (`unique (empresa_id, nome)`).
- Preço na venda: preço especial do cliente → preço do tipo de veículo (da loja, senão o geral) → valor padrão. Essa ordem está em `gravarVenda` (`api/src/vendas.js`).
- Só serviço pode "gerar vistoria"; produto sempre grava `gera_vistoria = false`.
- Campo de preço vazio significa "usa o valor padrão" (a linha em `servico_precos` não é criada).
- Valores aceitam `150`, `"150.5"` ou `"1.234,56"` (função `dinheiro`).

## Pontos frágeis, TODOs e dívidas técnicas

- A tabela `servico_precos` aceita preço por loja (`loja_id`), e a consulta já dá preferência a ele, mas a API só grava preços gerais. Não há tela para preço por loja.
- As rotas de serviços ficam dentro de `vendas.js`, o que dificulta achar o código.
- `Servicos.jsx` importa `TIPOS` de `Vistorias.jsx`, um módulo oculto. Se `Vistorias.jsx` for removido, esta tela quebra.
- Não existe exclusão de serviço, só inativação (campo `ativo`).
