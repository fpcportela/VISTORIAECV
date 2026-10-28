# Módulo: Grupos e unidades

## Objetivo

Cadastrar a estrutura da rede: **grupos** (tabela `empresas`, um franqueado que pode ter várias lojas) e **unidades** (tabela `lojas`). Também cuida do que é do grupo como um todo: logo, endereço, cor do sistema e a preparação inicial de um grupo novo (perfil Administrador, plano de contas, tipos de arquivo, centros de custo).

Hierarquia no banco: `franquias` → `empresas` (grupo) → `lojas` (unidade).

## Arquivos principais

| Arquivo | Papel |
| --- | --- |
| `api/src/grupos.js` | Rotas `GET /api/grupos`, `POST/PUT /api/grupos`, `POST/PUT /api/unidades`. |
| `web/src/Grupos.jsx` | Tela "Grupos e unidades": `Grupos`, `EditorGrupo`, `EditorUnidade`, `CamposEndereco` (endereço com busca pelo CEP), redução do logo no navegador. |
| `web/src/tema.js` | `aplicarTema(cor)`, `PALETA`, `COR_PADRAO`: gera os tons do sistema a partir de uma cor. |
| `web/src/Inicio.jsx` | Seletor de grupo (só master), seletor de loja e a paleta de cores. |
| `db/01-schema.sql` (seções 1 e 3) | `franquias`, `empresas`, `lojas`, `preferencias_tema`. |
| `db/10-grupos.sql` | `grupo_ativo`, nova versão de `tem_loja`/`tem_empresa`/`pode`, `app_preparar_grupo`, `app_responsaveis`. |
| `db/14-logo-grupo.sql` | Coluna `empresas.logo`. |
| `db/22-cor-por-grupo.sql` | Cor salva por grupo: `app_grupo_da_cor`, `app_cor_tema`, `app_pode_cor_tema`, `app_salvar_cor_tema`. |
| `db/30-unidades-robo.sql` | Endereço do grupo (colunas em `empresas`). |
| `db/33-unidades-endereco-horario.sql` | `app_unidade_endereco_horario`: endereço da unidade e horário (o mesmo da agenda). |

## Funções e rotas públicas

| Função / rota | O que faz |
| --- | --- |
| `GET /api/grupos` | Grupos com as unidades. O master vê todos; os demais, só o próprio grupo e as unidades a que têm acesso. |
| `POST /api/grupos`, `PUT /api/grupos/:id` | Só master. Nome (razão social) obrigatório e em maiúsculas, nome fantasia, CNPJ opcional (validado), ativo, logo (data URL PNG/JPEG/WEBP, até ~400 mil caracteres) e endereço. Depois chama `app_preparar_grupo`. |
| `POST /api/unidades`, `PUT /api/unidades/:id` | Só master. Nome, CNPJ opcional, telefone, endereço, ativo. Na criação, o código é sequencial no grupo (`0001`, `0002`…). Depois chama `app_preparar_grupo` (cria o centro de custo da unidade nova). |
| `soMaster(db)`, `endereco(b)`, `cnpjOpcional(v)`, `duplicado(e, msg)` (internas) | Checagem de master, limpeza do endereço, CNPJ opcional e erro de CNPJ repetido. |
| `app_preparar_grupo(empresa)` | Cria, se faltar: perfil "Administrador" com todas as permissões; tipos de arquivo (RG, CPF, CNH…); plano de contas padrão (grupos 1 a 7 e categorias 1.01 a 7.01); um centro de custo por unidade. |
| `app_responsaveis(empresa)` | Usuários ativos que trabalham no grupo (ou master). |
| `grupo_ativo()` | Grupo escolhido pelo master no topo (`app.grupo`). |
| `app_grupo_da_cor()` | Grupo em uso: o escolhido pelo master ou o único grupo da pessoa. |
| `app_cor_tema()`, `app_pode_cor_tema()`, `app_salvar_cor_tema(cor)` | Cor do grupo; sem grupo definido, a cor pessoal; padrão `#0774B8`. Só master ou quem tem `config.gerenciar` muda a cor do grupo. |
| `app_unidade_endereco_horario(loja, end, horarios)` | Grava endereço da unidade e horário em `agenda_config` (usado pela tela do robô). Exige `whatsapp.enviar` ou `agenda.gerenciar`. |
| `aplicarTema(cor)` (front) | Define as variáveis CSS `--primaria`, `--forte` (escurece até dar contraste), `--sobre-primaria`, `--clara` e a `theme-color`. |
| `CamposEndereco({ f, setF })`, `mascaraCep(v)` (front) | Endereço com preenchimento pelo CEP (`/api/cep/:cep`). Também usado em `WhatsApp.jsx`. |

## Dependências

- **Depende de:** [acesso-e-usuarios](acesso-e-usuarios.md) (master, RLS), `documentos.js` (`cnpjValido`, ver [clientes](clientes.md)), rota `/api/cep` (em `vendas.js`).
- **Quem depende dele:** praticamente todos os módulos, porque todo dado é de uma loja ou de um grupo. `app_preparar_grupo` alimenta [financeiro](financeiro.md) (plano de contas, centros de custo) e [colaboradores-e-ponto](colaboradores-e-ponto.md) (tipos de arquivo). O logo aparece no menu e nos PDFs de [relatorios](relatorios.md) e [vendas](vendas.md). O endereço da unidade é usado pela [agenda](agenda.md) e pelo [robô](whatsapp-e-robo.md).

## Tabelas usadas

`franquias`, `empresas`, `lojas`, `preferencias_tema`, `perfis`, `perfil_permissoes`, `tipos_arquivo`, `categorias_financeiras`, `centros_custo`, `agenda_config`. Gatilhos de auditoria em `empresas` e `lojas`.

## Regras de negócio e casos especiais

- Só o **master** cadastra e altera grupos e unidades. Quem tem `lojas.ver` só enxerga as unidades do próprio grupo.
- O master escolhe um grupo no topo da tela (ou "TODOS OS GRUPOS"). A escolha fica no `localStorage` e vai no cabeçalho `X-Grupo`; trocar de grupo recarrega a página (avisando se há venda nova não salva).
- Um grupo novo é ligado à **primeira franquia** cadastrada (`order by criado_em limit 1`).
- A unidade pode ter ou não CNPJ próprio. O código da unidade também é usado como centro de custo.
- A cor do sistema é do **grupo**: todo mundo do grupo vê a mesma. O master em "todos os grupos" muda só a cor pessoal.
- Só o master libera a IA do robô para um grupo (gatilho `empresas_ia_so_master`, `db/18`).

## Pontos frágeis, TODOs e dívidas técnicas

- A tabela `franquias` não tem tela nem rota; o grupo novo sempre vai para a primeira franquia. Com mais de uma franquia, isso daria errado.
- As colunas `lojas.latitude`, `lojas.longitude` e `lojas.raio_ponto_m` ("usado para validar o ponto") existem, mas nenhum código da API, do app ou das migrações seguintes as usa. O ponto atual não valida a localização.
- O logo é guardado como data URL dentro da tabela `empresas` e vai inteiro em toda resposta de `GET /api/eu` e `GET /api/grupos`.
- Não existe exclusão de grupo ou unidade, só o campo `ativo`.
- O plano de contas padrão está escrito duas vezes: em `db/08-financeiro.sql` (para os grupos que já existiam, encaixando as categorias antigas) e em `app_preparar_grupo` (`db/10`, para grupos novos). Mudar o plano exige mudar os dois lugares.
