# Módulo: Consulta de placa e FIPE

## Objetivo

- Buscar os dados de um veículo pela placa na **API Placas** (apiplacas.com.br / wdapi2.com.br), serviço pago por consulta, guardando o resultado para não pagar de novo dentro do prazo.
- Oferecer as listas de **marcas e modelos** da tabela FIPE (API pública parallelum) para digitar o veículo na venda, também guardadas no banco.
- Mostrar e digitar placas no padrão antigo (ABC-1234) e Mercosul (ABC1D23).

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/placas.js` | `consultarApiPlacas`, `mapearVeiculo`, `normalizarPlaca`, `ErroPlaca`, `CACHE_DIAS`. |
| `api/src/index.js` | Rota `GET /api/placa/:placa` (cache, chamada à API, gravação do veículo e do histórico). |
| `api/src/fipe.js` | Rotas `GET /api/fipe/marcas` e `GET /api/fipe/modelos`. |
| `web/src/ConsultaPlaca.jsx` | Janela "Consulta de placa" (buscar, atualizar, usar na venda, abrir venda nova). |
| `web/src/Placa.jsx` | `Placa` (desenho da placa), `PlacaInput`, `PlacasDiversas`, `limparPlaca`, `placaValida`, `formatarPlaca`, `filtrarPlaca`, `ehAntiga`. |
| `web/src/Veiculo.jsx` | `SeletorVeiculo`: tipo, marca e modelo com listas da FIPE (guardadas em memória na sessão). |
| `db/01-schema.sql` (seção 4) | `veiculos` (placa única) e `consultas_placa` (histórico). |
| `db/07-fipe.sql` | `fipe_marcas`, `fipe_modelos`. |

## Funções e rotas públicas

| Função / rota | O que faz |
| --- | --- |
| `normalizarPlaca(texto)` | Tira tudo que não é letra/número, põe em maiúsculas e devolve a placa se for `AAA9A99`/`AAA9999`, senão `null`. Usada também por vendas, robô e busca. |
| `consultarApiPlacas(placa)` | `GET {API_PLACAS_URL}/{API_PLACAS_ROTA}/{placa}` com `Authorization: Bearer API_PLACAS_TOKEN`, tempo limite de 20 s. Erros viram `ErroPlaca` com mensagem própria (400, 401, 402 saldo, 404, 503). Sem token: erro 503 "ainda não foi configurada". |
| `mapearVeiculo(resposta)` | Converte a resposta em `tipo` (pelo texto de tipo/espécie: moto, caminhão, carro ou outro), marca, modelo, versão, anos, cor, combustível, chassi, renavam, motor, município e UF. |
| `GET /api/placa/:placa?loja=&atualizar=1` | Exige `placa.consultar`. Se o veículo foi consultado há menos de `CACHE_DIAS` dias e não pediram para atualizar, devolve o guardado (origem `cache`). Senão chama a API, grava/atualiza `veiculos` e registra em `consultas_placa`. Se a API falhar e houver dado consultado antes, devolve o guardado com um aviso. |
| `GET /api/fipe/marcas?tipo=` | Marcas do segmento (carros, motos, caminhões; `outro` usa carros). Usa o banco se todas tiverem menos de 30 dias; senão busca na FIPE e grava. Sem internet, devolve o que estiver guardado. |
| `GET /api/fipe/modelos?tipo=&marca=` | Mesma lógica para os modelos de uma marca. |
| `ConsultaPlaca({ loja, placaInicial, aoFechar, aoUsar, aoAbrirVenda })` | Busca a placa; com `aoAbrirVenda`, ao achar já abre uma venda nova com o veículo. Mostra "Atualizar consulta" quando o dado veio do cache. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md) (`pode('placa.consultar')`), API Placas (paga, token no `api/.env`), FIPE parallelum (pública).
- **Quem depende dele:** [vendas](vendas.md) (veículo da venda, relatório da consulta anexado ao item), [inicio](inicio.md) (botão Placa e pesquisa do topo), [whatsapp-e-robo](whatsapp-e-robo.md) (`normalizarPlaca`), [vistorias](vistorias.md) (oculto).

## Tabelas usadas

`veiculos`, `consultas_placa`, `fipe_marcas`, `fipe_modelos`.

## Regras de negócio e casos especiais

- **Cobrança:** a mesma placa fica guardada por `API_PLACAS_CACHE_DIAS` dias (padrão 30). Dentro do prazo não há nova cobrança, a não ser que a pessoa clique em "Atualizar consulta".
- Rota configurável: `basico` (R$ 0,03), `basico-fipe` (R$ 0,08) ou `completa` (R$ 0,20, com chassi, motor e renavam), segundo o `api/.env.exemplo`.
- Ao atualizar, chassi, renavam e motor só são trocados se a nova resposta trouxer valor (`coalesce`), para uma consulta `basico` não apagar o que a `completa` trouxe.
- Um veículo criado só pela digitação da placa numa venda (sem `consultado_em`) não conta como dado guardado.
- Toda consulta, inclusive as do cache e as que falharam, fica em `consultas_placa` com a loja e o usuário.
- A resposta completa da API fica em `veiculos.dados_consulta`, mas não é devolvida ao app.

## Pontos frágeis, TODOs e dívidas técnicas

- A tabela `veiculos` é **global** (sem `empresa_id`/`loja_id` e sem RLS): todos os grupos compartilham os dados de uma placa e o cache. As tabelas `fipe_marcas` e `fipe_modelos` também são globais. ⚠️ verificar se o compartilhamento entre grupos é desejado.
- O valor `ocr_foto` do tipo `origem_consulta` e as colunas `foto_path`/`confianca_ocr` sobraram da leitura de placa por foto, que saiu do sistema (`db/05` apaga a permissão `placa.foto`).
- A rota da placa fica em `index.js`, separada de `placas.js`.
- Sem `loja` na consulta, a API usa a primeira loja de `app_minhas_lojas()` para registrar o histórico e conferir a permissão.
- `Veiculo.jsx` importa `TIPOS` de `Vistorias.jsx` (módulo oculto).
