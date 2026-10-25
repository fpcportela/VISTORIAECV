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

## Rodar no dia a dia

```bash
cd ~/Documents/"AI CLAUDE"/vistoria-ecv
npm run banco      # liga o banco de dados (o Docker Desktop precisa estar aberto)
npm run dev        # liga a API e o app
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
