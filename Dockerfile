# Production image for Coolify (or any Docker host).
# nginx serves the Vite build at /contract-whist/ on port 80 and proxies
# /contract-whist/api/ to the Node server (server/src, SQLite in /data).
# Mount a persistent volume at /data. Environment variables (PUBLIC_URL,
# ADMIN_BOOTSTRAP_TOKEN, IMPORT_TOKEN, TRUST_PROXY_HOPS) are in the README,
# "Deploying (Coolify)".

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:server

# node:sqlite needs Node 22.13+; node:22-alpine tracks the latest 22.x.
FROM node:22-alpine
RUN apk add --no-cache nginx \
  && ln -sf /dev/stdout /var/log/nginx/access.log \
  && ln -sf /dev/stderr /var/log/nginx/error.log
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/contract-whist
COPY --from=build /app/server/dist/index.mjs /srv/whist/index.mjs
COPY server/docker-entrypoint.sh /docker-entrypoint.sh
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1/contract-whist/api/health || exit 1
ENTRYPOINT ["/docker-entrypoint.sh"]
