# Multi-stage build: compile TypeScript, then run the compiled output on a
# slim runtime image with only production dependencies.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS production
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

# node:22-alpine ships an unprivileged "node" user — no need to create one.
USER node

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3001/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
