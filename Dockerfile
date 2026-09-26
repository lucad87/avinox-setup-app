# --- STAGE 1: build ---
FROM node:20-alpine AS builder

WORKDIR /app

# Every dependency, dev ones included: the TypeScript compiler is one of them.
COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

# --- STAGE 2: runtime ---
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY public ./public

# The official image ships an unprivileged user: the server needs no root.
USER node

EXPOSE 3080

# node directly, not npm: the process receives SIGTERM and stops cleanly.
CMD ["node", "dist/server.js"]
