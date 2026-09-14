# Builds the static client and bundles it into a Caddy image that also
# terminates TLS and reverse-proxies Socket.IO to the app server.
# Build context must be the repo root (needs both client/ and deploy/).

FROM node:22-alpine AS client-build
WORKDIR /app
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM caddy:2-alpine
COPY --from=client-build /app/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
