# ──────────────────────────────────────────────
# Stage 1 – Install deps & compile TypeScript
# ──────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy lockfile + manifest first (cache-friendly layer)
COPY package.json package-lock.json ./

# Install ALL dependencies (dev + prod) for the build step
# --ignore-scripts prevents husky/prepare from running inside Docker
RUN npm ci --ignore-scripts

# Copy source code + tsconfig
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript → dist/
RUN npm run build

# ──────────────────────────────────────────────
# Stage 2 – Lean production image
# ──────────────────────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

# Install PostgreSQL client for pg_dump (used by cron backups)
RUN apk add --no-cache postgresql-client

# Security: run as non-root
RUN addgroup -S mhorpix && adduser -S mhorpix -G mhorpix

# Copy package manifests and install production-only deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Own the working directory
RUN chown -R mhorpix:mhorpix /app

USER mhorpix

# Production mode for optimal V8 performance
ENV NODE_ENV=production

# Graceful shutdown: forward SIGTERM to node
STOPSIGNAL SIGTERM

CMD ["node", "dist/index.js"]
