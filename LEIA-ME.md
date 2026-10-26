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
horários livres) e pode mandar a confirmação pelo WhatsApp.

No robô do WhatsApp, a pergunta **Horário da vistoria (agenda)** mostra os próximos horários livres
da loja do robô (o cliente responde com o número, ou MAIS para ver outros). O horário fica reservado
na hora da escolha, a venda FUTURO abre com a data do agendamento e a mensagem final diz o dia, a hora
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
- **Abrir venda**: abre a venda **FUTURO** com o cliente e o veículo e manda a mensagem final.
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
