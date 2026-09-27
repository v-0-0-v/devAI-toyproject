# Multi-stage build: compile TypeScript, then run the compiled output on a
# slim runtime image with only production dependencies.
#
# Debian-based (not alpine): mediasoup ships a prebuilt, glibc-linked worker
# binary (see sfu.ts) — alpine's musl libc can't run it, and there's no musl
# prebuild to fall back to, so alpine would fail at container startup with a
# loader error rather than at build time.

FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# mapdata.json ships alongside the compiled output (see map.ts's
# import.meta.url-relative default path); MAP_DATA_PATH can override it.
COPY --from=build /app/dist/mapdata.json ./dist/mapdata.json

# SQLite persistence (whiteboard strokes + reports, see persistence.ts)
# lives here by default — mount this as a volume in production so it
# survives container recreation, not just process restarts.
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME /app/data

# node:22-slim ships an unprivileged "node" user — no need to create one.
USER node

EXPOSE 3001
# mediasoup's WebRTC media (UDP/TCP RTP+ICE+DTLS), see sfu.ts's
# MEDIASOUP_MIN_PORT/MEDIASOUP_MAX_PORT. Must be published to the host
# directly (not proxied through Caddy — see docker-compose.prod.yml) and
# match whatever range those env vars are actually set to.
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
