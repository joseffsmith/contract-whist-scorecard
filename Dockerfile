# Production image for Coolify (or any Docker host).
# Builds the Vite app and serves it with nginx at /contract-whist/ on port 80.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/contract-whist
EXPOSE 80
