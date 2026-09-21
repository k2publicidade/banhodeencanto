# Sistema Banho de Encanto - imagem de producao (Next.js + SQLite em arquivo)
#
# O banco e um ARQUIVO: ele precisa ficar num volume (disco de verdade), nunca
# dentro da imagem. Aponte BDE_DB_PATH para o volume, ex.: /dados/banho.db.
#
#   docker build -t banhodeencanto .
#   docker run -d --name banhodeencanto \
#     -p 3000:3000 \
#     -e BDE_DB_PATH=/dados/banho.db \
#     -e BDE_SECRET="uma-chave-longa-e-secreta" \
#     -v banho-dados:/dados \
#     banhodeencanto

FROM node:22-alpine AS dependencias
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=dependencias /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS execucao
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    TZ=America/Sao_Paulo \
    BDE_DB_PATH=/dados/banho.db

# Só o necessário para rodar: build, dependências, schema e scripts de manutenção
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/public ./public
COPY --from=build /app/lib ./lib
COPY --from=build /app/scripts ./scripts

RUN mkdir -p /dados

EXPOSE 3000

# Healthcheck simples: a tela de login responde 200 quando o banco esta acessivel
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
