FROM node:22-bookworm-slim AS build

WORKDIR /app/web

COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./
RUN npm run build

FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

COPY --from=build /app/web/dist /usr/share/nginx/html
COPY nginx/templates /etc/nginx/templates
COPY nginx/docker-entrypoint.d /docker-entrypoint.d
RUN chmod +x /docker-entrypoint.d/10-certificado-fallback.sh
