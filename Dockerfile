# ============================================================
# Stage 1: Build
# ============================================================
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update -qq && \
    apt-get install -y -qq python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# Copy dependency manifests
COPY package.json bun.lock ./

# Install all dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build the project
RUN bun run build

# ============================================================
# Stage 2: Production runtime
# ============================================================
FROM oven/bun:1.2-slim

WORKDIR /app

# Install ca-certificates for HTTPS requests
RUN apt-get update -qq && \
    apt-get install -y -qq ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy built artifacts and production dependencies
COPY package.json bun.lock ./
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/

# Expose the server port
EXPOSE 4005

# Set default environment variables
ENV BOUNTY_PORT=4005
ENV BOUNTY_DB_PATH=/app/data/bounty.db
ENV NODE_ENV=production

# Create data directory
RUN mkdir -p /app/data

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:${BOUNTY_PORT}/health').then(r => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"

# Run the server
CMD ["bun", "run", "dist/server/server.js"]
