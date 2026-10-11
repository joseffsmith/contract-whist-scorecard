# Production image for Coolify (or any Docker host).
# Builds the Vite app and serves it with nginx at /contract-whist/ on port 80,
# plus the password sign-in service (server/auth.mjs) at /contract-whist/api/.
# Password hashes live in /data — mount a persistent volume there and set
# INSTANT_ADMIN_TOKEN.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache nodejs
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/contract-whist
COPY server/auth.mjs /srv/auth/auth.mjs
COPY server/start-auth.sh /docker-entrypoint.d/40-start-auth.sh
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 80
