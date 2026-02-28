# Build context is repo root (set in docker-compose.yml)
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
# wget for HEALTHCHECK; create runtime dirs before dropping privileges
RUN apk add --no-cache wget && \
    addgroup -S medtrust && adduser -S medtrust -G medtrust && \
    mkdir -p /app/logs /app/uploads && \
    chown -R medtrust:medtrust /app
COPY --from=builder /app/node_modules ./node_modules
COPY backend/src ./src
COPY backend/package.json ./
# Copy proto files from ai-services so grpc.js can load them at runtime
# grpc.js resolves: __dirname/../../../ai-services/proto → /app/ai-services/proto
COPY ai-services/proto ./ai-services/proto
USER medtrust
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/v1/health || exit 1
CMD ["node", "src/server.js"]
