# Vistoria ECV no servidor (Hostinger VPS)

Tudo roda no Docker da VPS, em `/opt/vistoria-ecv`:

| Serviço | O que faz | Porta |
| --- | --- | --- |
| `caddy` | https (certificado automático), entrega o app e repassa `/api` | 80 e 443 (as únicas abertas) |
| `api` | Node (pasta `api/`), com o cliente do PostgreSQL para o backup pela tela | interna 3001 |
| `banco` | PostgreSQL 16 | interna |
| `whatsapp` | Evolution API (QR code), só com `WHATSAPP=sim` | interna |

## Primeira instalação

Numa VPS Ubuntu 24.04, como root:

```bash
# Docker
curl -fsSL https://get.docker.com | sh
# usuário de deploy (sem senha, só chave SSH)
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/ && chown -R deploy:deploy /home/deploy/.ssh
# firewall: só SSH, http e https
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
apt-get install -y fail2ban unattended-upgrades rclone
mkdir -p /opt/vistoria-ecv && chown deploy:deploy /opt/vistoria-ecv
```

Como `deploy`:

```bash
git clone -b consulta-placa https://github.com/fpcportela/vistoriaecv.git /opt/vistoria-ecv
cd /opt/vistoria-ecv
cp deploy/.env.exemplo deploy/.env && chmod 600 deploy/.env
nano deploy/.env        # preencher DOMINIO, senhas (openssl rand -hex 32) e tokens
./deploy/deploy.sh
```

Se o repositório for privado, crie uma *deploy key* só de leitura (`ssh-keygen -t ed25519 -f ~/.ssh/github`), cadastre a parte pública em GitHub > Settings > Deploy keys e clone com `git@github.com:fpcportela/vistoriaecv.git`.

Antes do primeiro acesso, o DNS precisa ter um registro **A** de `vistoriaecv` (em `novatec.cloud`) apontando para o IP da VPS. Sem isso o Caddy não consegue o certificado.

Depois de entrar com `admin@vistoriaecv.local` / `admin123`, **troque a senha** (ou restaure os dados reais, abaixo).

## Atualizar

```bash
/opt/vistoria-ecv/deploy/deploy.sh
```

Faz backup, baixa o branch `DEPLOY_RAMO` (padrão `consulta-placa`), gera as imagens, roda as regras do banco (os mesmos `db/*.sql` do `npm run banco:atualizar`) e reinicia. Também dá para rodar pelo GitHub: Actions > **Publicar no servidor** > Run workflow (precisa dos Secrets `VPS_HOST`, `VPS_USUARIO` e `VPS_CHAVE_SSH`).

## Backups

```bash
crontab -e
0 3 * * * /opt/vistoria-ecv/deploy/backup-diario.sh >> /opt/vistoria-ecv/deploy/backups/backup.log 2>&1
```

Ficam em `deploy/backups` por `BACKUP_DIAS` (padrão 14). Para mandar uma cópia ao Google Drive: `rclone config` (crie um remoto `gdrive`) e coloque `RCLONE_DESTINO=gdrive:Vistoria ECV - backups/servidor` no `deploy/.env`.

## Trazer os dados do Mac (virada)

1. No Mac, feche o sistema com `Ctrl + C` e espere **Liberado** (ou rode `npm run drive:salvar`).
2. Copie o `.dump` mais novo da pasta do Drive `Vistoria ECV - backups` para o servidor:
   `scp arquivo.dump deploy@IP:/opt/vistoria-ecv/deploy/backups/`
3. No servidor: `./deploy/restaurar.sh deploy/backups/arquivo.dump` (pede para digitar SIM).
4. No sistema: WhatsApp > Configurar > **Mostrar QR code** e ler de novo com cada número.
5. No Mac: `npm run whatsapp:parar` e troque o atalho pelo endereço https do servidor.

## Comandos úteis

```bash
cd /opt/vistoria-ecv
docker compose -f deploy/docker-compose.yml ps
docker compose -f deploy/docker-compose.yml logs -f --tail 100 api
docker compose -f deploy/docker-compose.yml exec banco psql -U vistoria vistoria_ecv
```
