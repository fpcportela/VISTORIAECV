# API do Vistoria ECV para o servidor. Construído a partir da raiz do projeto:
#   docker compose -f deploy/docker-compose.yml build
FROM node:22-alpine
# pg_dump / pg_restore / psql 16 para o backup e a recuperação feitos pela tela (Configurações → Backup)
RUN apk add --no-cache postgresql16-client tzdata
ENV TZ=America/Sao_Paulo NODE_ENV=production
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev
COPY api/src ./src
RUN mkdir -p /app/backups-automaticos && chown -R node:node /app
USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
