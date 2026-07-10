# --- Stage 1: Build the React/Vite app ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps
COPY package.json bun.lock* package-lock.json* ./
RUN if [ -f bun.lock ] || [ -f bun.lockb ]; then \
      npm install -g bun && bun install --frozen-lockfile; \
    else \
      npm install; \
    fi

# Copy source and build
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public

# Default API base: same-origin (works behind k8s Ingress)
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN bun run build || npm run build

# --- Stage 2: Serve via nginx ---
FROM nginx:1.27-alpine

# SPA-friendly nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
