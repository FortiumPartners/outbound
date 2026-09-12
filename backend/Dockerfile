FROM node:20-alpine AS base

# Install OpenSSL for Prisma compatibility on Alpine Linux
RUN apk add --no-cache openssl

WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json package-lock.json ./
# npm ci installs exactly what package-lock.json pins, so security bumps landed in
# the lockfile are what ends up in the image.
RUN npm ci

# Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Production
FROM base AS runner
ENV NODE_ENV=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE 8000

# Use Node.js for health check (wget not available in Alpine)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:8000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]

# Development target
FROM base AS dev
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
EXPOSE 8000
CMD ["npm", "run", "dev"]
