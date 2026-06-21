# --- STAGE 1: Compilazione del codice (Build) ---
FROM node:20-alpine AS builder

WORKDIR /app

# Copia i file di configurazione per installare TUTTE le dipendenze (incluse quelle di sviluppo)
COPY package*.json tsconfig.json ./
RUN npm ci

# Copia il codice sorgente del backend e compila in JavaScript
COPY src/ ./src/
RUN npm run build

# --- STAGE 2: Ambiente di esecuzione leggero (Production) ---
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Copia i package.json e installa SOLO le dipendenze di produzione (niente TypeScript o strumenti di sviluppo)
COPY package*.json ./
RUN npm ci --only=production

# Copia il backend compilato in JavaScript dallo Stage 1
COPY --from=builder /app/dist ./dist

# Copia l'interfaccia grafica (Frontend statico)
COPY public ./public

# Espone la porta interna utilizzata dall'applicazione
EXPOSE 3000

# Avvia l'applicazione in modalità produzione
CMD ["npm", "run", "serve"]