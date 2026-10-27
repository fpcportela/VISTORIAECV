# Vistoria ECV · ERP para franquias de vistoria

Versão 0.1: login e tela inicial (computador e celular), com troca de cor do sistema e
dados reais do banco (contas a receber e a pagar, vistorias do dia, royalties do mês).

## O que tem aqui

| Pasta | O que é |
| --- | --- |
| `db/` | Banco de dados PostgreSQL: tabelas, regras, login e dados iniciais |
| `api/` | Servidor (Node.js) que o app usa para ler e gravar no banco |
| `web/` | O app (React). Abre no navegador do computador e no celular |
| `docker-compose.yml` | Sobe o banco de dados no seu computador com o Docker |

## Preparar o Mac (uma vez só)

1. Instale o **Node.js 20 ou mais novo**: https://nodejs.org (botão "LTS").
2. Instale o **Docker Desktop**: https://www.docker.com/products/docker-desktop e abra o programa.
3. No Terminal, entre na pasta do projeto e instale as dependências:

```bash
cd ~/Documents/"AI CLAUDE"/vistoria-ecv
npm run instalar
cp api/.env.exemplo api/.env
```

## Consulta de placa (API Placas)

A busca de placa usa a API Placas (apiplacas.com.br), que é paga por consulta.
Pegue o token no painel da sua conta e coloque no arquivo `api/.env`:

```
API_PLACAS_TOKEN=seu-token-aqui
API_PLACAS_ROTA=completa
```

`completa` traz chassi, motor e renavam (R$ 0,20 por consulta). `basico` custa R$ 0,03,
mas não traz esses números. A mesma placa fica guardada por 30 dias: buscar de novo
nesse período não gera cobrança, a não ser que você clique em "Atualizar consulta".

## Agenda de vistorias

Menu **Agenda**: os horários de cada loja por dia ou semana, com os livres e os agendados.
Em **Horários** a loja define os dias e horas de atendimento, o almoço, a duração de cada vistoria,
quantas vistorias cabem ao mesmo tempo, a antecedência mínima, até quantos dias à frente dá para
agendar e os bloqueios (feriado, folga). **+ Agendar** marca na mão (com "Encaixe" para fora dos
horários livres). Com o celular preenchido, ao clicar em **Agendar** abre a janela **Chamado no
WhatsApp**: escolha em qual coluna dos chamados fica o atendimento (se o contato já tem um chamado
aberto, ele muda para essa coluna) e se manda a confirmação pelo WhatsApp. A confirmação fica na
conversa do chamado.

A confirmação pergunta **"Confirma o agendamento? Responda SIM ou NÃO."** e o robô cuida da resposta:
SIM deixa o agendamento **Confirmado**; NÃO pergunta para qual dia remarcar (aceita 30/10, 30, amanhã,
sexta...), mostra os horários livres desse dia e remarca no horário escolhido (pelo número da lista
ou pela hora, ex.: 14:30). Se o cliente pedir um atendente, a conversa segue para o atendimento normal.
Na agenda, **Dia / Semana / Mês** mudam a visão (o mês mostra o calendário com os agendamentos de cada dia;
clique no dia para abrir). O botão **Abrir venda** no agendamento abre uma venda nova já com o cliente,
a placa, o serviço e a unidade do agendamento; ao salvar a venda, o agendamento fica **Compareceu** e
ganha o link da venda. Uma venda já ligada ao agendamento (ex.: a do robô), salva no dia ou depois,
também marca **Compareceu**.

Toda remarcação (pelo cliente ou na tela) fica no histórico: o cartão do agendamento lista as
respostas e remarcações, e o dia de onde ele saiu mostra um registro tracejado "Remarcado" no horário antigo.

No robô do WhatsApp, a pergunta **Horário da vistoria (agenda)** mostra os próximos horários livres
da loja do robô (o cliente responde com o número, ou MAIS para ver outros). O horário fica reservado
na hora da escolha, a venda AGENDADO abre com a data do agendamento e a mensagem final diz o dia, a hora
e o endereço. Com IA, o robô oferece os mesmos horários livres na conversa.

Cadastro de cliente sempre pelo CPF/CNPJ, sem duplicar: no **+ Agendar**, o CPF/CNPJ acha o cliente
já cadastrado (ou cadastra um novo ao agendar) e, ao digitar o nome, aparecem os clientes parecidos.
Sem documento, o agendamento fica só com o nome. O robô faz igual: com CPF/CNPJ usa o cadastro
existente; sem documento, a venda vai para o particular/avulso e ninguém é cadastrado.

## Preço especial por cliente

No cadastro do cliente, **Preços especiais > Ver e alterar** mostra todos os serviços e produtos com o
preço normal e um campo para o preço daquele cliente (em branco = preço normal). Num grupo de empresas,
o preço do grupo vale para as empresas dele que não tiverem preço próprio. Na venda, ao escolher o
cliente cadastrado, os itens já vêm com o preço dele (e acompanham se o cliente for trocado); a venda
aberta pelo robô do WhatsApp para um cliente cadastrado também usa o preço dele.

O **Novo cadastro** na venda e na agenda abre a mesma tela do cadastro de clientes, já com a tabela de
preços especiais. Se o CPF/CNPJ digitado já tem cadastro, a tela avisa e oferece **Usar este cadastro**.

## Preço travado na venda

O valor unitário de cada item vem travado: preço especial do cliente ou, sem ele, o da tabela do serviço.
Para alterar, clique no valor e informe o e-mail e a senha de quem pode autorizar (a mesma permissão do
desconto, "Dar desconto"). Os preços ficam liberados até salvar a venda, e a alteração fica no histórico.
Um preço já salvo na venda continua valendo ao reabrir.

## CEP no cadastro de cliente

Ao digitar o CEP completo, o endereço (rua e bairro), a cidade e a UF são preenchidos pela ViaCEP (ou
BrasilAPI, se a ViaCEP falhar). O número fica para completar. Os preços especiais têm a vírgula automática.

## Robô reconhece o cliente

Quando alguém manda mensagem, o robô procura o cliente no cadastro: o já ligado ao contato ou, se não
houver, o único cliente com aquele WhatsApp/telefone (mesmo DDD e mesmos 8 últimos dígitos). Achando,
liga o contato ao cliente, cumprimenta pelo primeiro nome e não pergunta de novo nome, CPF/CNPJ e e-mail.
A venda sai no nome dele, com os preços especiais. Vendas abertas pelo robô aparecem como **Agendado**,
com a linha azul clara na lista, até alguém confirmar.

## Unidades no robô e responsável

Em **Grupos e unidades**, o grupo e cada unidade têm endereço (o CEP preenche rua, bairro, cidade e UF).
Se o grupo tem mais de uma unidade ativa, o robô pergunta logo depois das boas-vindas em qual unidade o
cliente quer atendimento, mostrando o endereço de cada uma; os horários, o agendamento e a venda são da
unidade escolhida. Em **WhatsApp > Robô**, escolha o responsável padrão e, se quiser, um por unidade:
quando o robô agenda (abre a venda) ou passa a conversa para uma pessoa, o chamado vai para ele.

## Justificativa do ponto por marcação

No espelho do ponto, cada marcação (entrada, saída almoço, volta almoço, saída) tem o seu ✎ para
justificar, com documentos anexados. "Justificar o dia" continua existindo para falta ou atestado do dia
inteiro. O relatório em PDF lista cada justificativa com o nome da marcação.

## Vendas em aberto na tela inicial

Abaixo das vistorias vendidas no mês, a tela inicial mostra quantas vendas estão em aberto (amarelo) e
quantas foram agendadas pelo WhatsApp (azul). Clicar abre a lista de vendas já filtrada.

## Venda sem serviço

**Salvar** grava a venda mesmo sem serviço (por exemplo, só com o cliente e a placa). Ela fica aberta e
aparece em amarelo na lista de vendas, com "Falta o serviço", até alguém completar. Finalizar continua
exigindo o serviço de cada veículo.

## WhatsApp (API oficial da Meta)

Sem configuração, o módulo WhatsApp fica em **modo teste**. Nesse modo as mensagens ficam só no
sistema, e o código de "Esqueci a senha" aparece no terminal da API. Para ligar de verdade:

1. Crie a conta no Meta Business, um app do tipo Empresa com o produto WhatsApp, e cadastre o número da loja.
2. Gere um token permanente (usuário do sistema) e copie a chave secreta do app.
3. Aprove um modelo de **autenticação** chamado `codigo_acesso`, em português, com o botão de copiar código.
4. Coloque no `api/.env`:

```
WHATSAPP_PROVEDOR=meta
WHATSAPP_TOKEN=token-permanente
WHATSAPP_APP_SECRET=chave-secreta-do-app
WHATSAPP_VERIFY_TOKEN=uma-senha-que-voce-inventa
WHATSAPP_MODELO_CODIGO=codigo_acesso
```

5. No sistema, em WhatsApp > Configurar, informe o ID do número (Phone number ID) de cada grupo.
6. Para **receber** mensagens, o sistema precisa estar num endereço público com https (a Hostinger).
   No painel da Meta, cadastre o webhook `https://seu-endereco/api/whatsapp/webhook` com a mesma
   `WHATSAPP_VERIFY_TOKEN` e assine o campo `messages`. No Mac (localhost), só o envio funciona.

Pela regra do WhatsApp, uma resposta livre só pode ser enviada até 24 horas depois da última
mensagem do cliente.

O **comprovante do ponto** (gerado na saída final do dia) vai para o celular do colaborador por um
modelo aprovado com cabeçalho de **documento**, chamado `comprovante_ponto`, com o corpo usando
{{1}} para o nome e {{2}} para a data. Para usar outro nome, coloque `WHATSAPP_MODELO_PONTO=nome-do-modelo`
no `api/.env`. O comprovante também fica guardado no espelho do ponto (ícone 🧾 na coluna Horas).

### WhatsApp por QR code, sem a Meta (Evolution API, não oficial)

Liga o WhatsApp normal de um celular lendo um QR code, como no WhatsApp Web. Não precisa de conta na
Meta nem de modelos aprovados. **Atenção:** é contra as regras do WhatsApp e o número pode ser bloqueado,
principalmente se mandar muitas mensagens para quem não falou com a loja antes. Use um número de teste.

1. Invente uma chave longa e coloque a mesma `EVOLUTION_API_KEY` no `.env` da raiz (o do Docker) e no `api/.env`.
2. No `api/.env`, coloque também:

```
WHATSAPP_PROVEDOR=evolution
EVOLUTION_URL=http://localhost:8080
EVOLUTION_API_KEY=a-mesma-chave
```

3. Rode `npm run whatsapp:ligar` (baixa e liga o serviço da Evolution no Docker, ao lado do banco).
4. Religue a API (`npm run iniciar`). No sistema, em WhatsApp > Configurar, clique em **Mostrar QR code**
   e leia com o celular em WhatsApp > Dispositivos conectados > Conectar dispositivo.

As mensagens recebidas chegam no quadro e o robô responde, mesmo no Mac (não precisa de endereço público).
O comprovante do ponto vai como arquivo, sem modelo. Para desligar o serviço: `npm run whatsapp:parar`.
Se a API não estiver no mesmo computador do Docker, ajuste `EVOLUTION_WEBHOOK_URL`
(padrão `http://host.docker.internal:3001/api/whatsapp/evolution`).

### Robô de atendimento

Em WhatsApp > Robô de atendimento cada grupo monta o **fluxo de atendimento** em blocos, que o robô
segue a partir do bloco 1:

- **Mensagem**: manda um texto e segue.
- **Menu de opções**: manda a pergunta com as opções numeradas; cada opção leva para um bloco.
- **Pergunta**: pede um dado (nome, CPF/CNPJ, placa, tipo de veículo, serviço, data, horário da agenda,
  e-mail ou pergunta livre) e confere a resposta.
- **Conversa com IA**: a IA conversa usando o prompt e a base de conhecimento; com dados marcados, junta
  esses dados; sem nenhum, só tira as dúvidas. Quando termina, segue o fluxo.
- **Abrir venda**: abre a venda **AGENDADO** com o cliente e o veículo e manda a mensagem final.
- **Passar para atendente** e **Encerrar**.

Cada bloco diz para onde vai depois ("Próximo bloco" ou "Ir para" outro bloco). Na venda, o botão
**Confirmar venda** passa ela para Aberta. Se um atendente responder na conversa, o robô para naquele
atendimento. O cliente também pode escrever ATENDENTE a qualquer momento.

**Prompt da IA**: o texto com quem é a loja, como falar, regras e preços (pode carregar de um .txt).
**Base de conhecimento**: textos e arquivos PDF ou TXT (até 10 MB cada, 30 MB no total) que a IA
consulta para responder. Documento do Word: salve como PDF.

A conversa com **IA** só aparece no grupo em que o master marcar "IA liberada" (depende do contrato).
Ela usa a API da Anthropic (Claude). Coloque no `api/.env`:

```
ANTHROPIC_API_KEY=chave-da-anthropic
ANTHROPIC_MODELO=claude-opus-5-5
```

O `ANTHROPIC_MODELO` é opcional. Com `claude-haiku-5-5` cada mensagem sai mais barata.

## Rodar no dia a dia

```bash
cd ~/Documents/"AI CLAUDE"/vistoria-ecv
npm run banco      # liga o banco de dados (o Docker Desktop precisa estar aberto)
npm run iniciar    # liga a API e o app para usar no dia a dia (não recarrega sozinho)
npm run dev        # só para quem está mexendo no código: recarrega a tela a cada arquivo alterado
```

Abra **http://localhost:5173** no navegador.

- Usuário: `admin@vistoriaecv.local`
- Senha: `admin123`

Para parar, aperte `Ctrl + C` no Terminal. O banco pode continuar ligado; para desligar use `npm run banco:parar`.

## Testar no celular

Com o celular no mesmo Wi-Fi do Mac, o Terminal mostra uma linha `Network: http://192.168.x.x:5173`.
Abra esse endereço no celular. Para instalar como app: no iPhone, Compartilhar > "Adicionar à Tela de Início";
no Android, menu do Chrome > "Instalar app".

## Usar em dois computadores pelo Google Drive (um de cada vez)

O sistema pode rodar no Mac ou em outro computador (Mac ou Windows), **nunca nos dois ao mesmo tempo**.
Os dados passam por uma pasta do Google Drive chamada `Vistoria ECV - backups`: o banco de verdade fica
em cada computador, e no Drive vão só os backups.

- **Ao abrir** (`npm run drive:iniciar`): confere se o outro computador ainda está com o sistema aberto
  (arquivo `em-uso.json` no Drive) e avisa; se o outro salvou algo mais novo, restaura esse backup
  (antes guarda o banco deste computador em `~/.vistoria-ecv/antes-de-restaurar`); depois liga o sistema.
- **Enquanto usa**: salva um backup no Drive a cada 60 minutos.
- **Ao fechar** (`Ctrl + C` na janela): salva o backup final no Drive e libera para o outro computador.
  Espere a mensagem **Liberado** e o Google Drive terminar de sincronizar antes de abrir no outro.

O Drive guarda os 20 backups mais novos. Outros comandos:

```bash
npm run drive:status      # quem está usando, último backup e com qual este computador está
npm run drive:salvar      # salva no Drive agora
npm run drive:fechar      # salva e libera (se a janela foi fechada sem Ctrl + C)
npm run drive:restaurar   # restaura o backup mais novo do Drive mesmo que pareça em dia
```

O Google Drive para computador precisa estar instalado e logado nos dois computadores (o sistema acha
a pasta "Meu Drive" sozinho). Se não achar, coloque no arquivo `.env` da pasta do projeto
`VISTORIA_DRIVE_PASTA=caminho-da-pasta`. O nome de cada computador pode ser trocado com `VISTORIA_MAQUINA=`.
Os dois computadores precisam estar com a mesma versão do sistema. O WhatsApp (QR code) só funciona no
computador em que ele foi conectado.

No Windows, instale o Node.js e o Docker Desktop, copie a pasta do projeto (com `api/.env` e `.env`),
rode `npm run instalar` e use o arquivo **Abrir Vistoria ECV (Windows).bat** (dois cliques).

## Atalho para abrir (atualiza, traz os dados do Drive e abre)

Os arquivos **Abrir Vistoria ECV (Mac).command** e **Abrir Vistoria ECV (Windows).bat** fazem tudo com dois cliques
(`npm run abrir` faz o mesmo):

1. liga o Docker e espera ele ficar pronto;
2. confere no GitHub se há versão nova do sistema e, se houver, instala (`npm run atualizar`): mantém os `.env`,
   os `node_modules` e os backups automáticos, guarda a versão anterior em `~/.vistoria-ecv/versao-anterior`,
   roda `npm run instalar` e atualiza as regras do banco sem perder os dados;
3. liga o banco e o WhatsApp (só no Mac, se estiver configurado);
4. traz os dados mais novos do Google Drive, liga o app e abre **http://localhost:5173** no navegador.

As atualizações vêm do branch `consulta-placa` (para trocar: `VISTORIA_RAMO=` no `.env` da pasta do projeto).
Sem internet, ele só avisa e abre a versão que já está no computador.

## Atualizar o banco sem perder os dados

Quando uma versão nova muda as regras do banco (funções, permissões), com o banco ligado rode:

```bash
npm run banco:atualizar
```

Pode rodar mais de uma vez sem problema; as vendas e cadastros continuam lá.

## Backup

Em **Configurações → Backup** (só o usuário master), clique em **Escolher pasta** e depois em **Fazer backup agora**. Cada backup é um arquivo novo, com dia, mês, ano e hora no nome (por exemplo `vistoria-ecv_backup_25-10-2026_22h35m10s.dump`); nenhum anterior é apagado ou substituído.

- Para guardar no Google Drive, escolha uma pasta dentro do "Google Drive" do Mac (programa Google Drive para computador).
- Escolher a pasta funciona no Google Chrome e no Edge. No Safari o arquivo vai para a pasta Downloads.
- O Docker precisa estar ligado.

Para voltar um backup (apaga os dados atuais e põe os do arquivo no lugar):

```bash
docker exec -i vistoria-ecv-banco pg_restore -U vistoria -d vistoria_ecv --clean --if-exists < caminho/do/arquivo.dump
```

## Apagar todos os dados e recomeçar

```bash
npm run banco:zerar
```

Isso recria o banco do zero com os dados iniciais (use com cuidado).

## Próximos passos

- Servidor final: um VPS na Hostinger com Docker (as hospedagens compartilhadas não têm PostgreSQL).
- Os módulos do menu (vistorias, financeiro, royalties, ponto…) serão feitos um por um.
