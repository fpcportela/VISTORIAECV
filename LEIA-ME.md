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

## Apagar todos os dados e recomeçar

```bash
npm run banco:zerar
```

Isso recria o banco do zero com os dados iniciais (use com cuidado).

## Próximos passos

- Servidor final: um VPS na Hostinger com Docker (as hospedagens compartilhadas não têm PostgreSQL).
- Os módulos do menu (vistorias, financeiro, royalties, ponto…) serão feitos um por um.
