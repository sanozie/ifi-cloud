FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable

# Copy monorepo (enough for Yarn workspaces)
COPY package.json yarn.lock .yarnrc.yml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services ./services

# Install deps without running lifecycle scripts
RUN yarn install

# Generate Prisma client and build all workspaces
RUN yarn workspace @ifi/db prisma generate
RUN yarn workspace @ifi/shared build \
    && yarn workspace @ifi/db build \
    && yarn workspace @ifi/api build

RUN ls -la /app/services/api/
RUN ls -la /app/services/api/dist/ || echo "dist directory not found"

# --- Runtime ---
FROM node:20-slim
WORKDIR /app

# Prisma requires OpenSSL at runtime in Debian-based images
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy production artifacts and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/api/package.json ./services/api/package.json
COPY --from=builder /app/services/api/dist ./services/api/dist

ENV NODE_ENV=production
USER node
WORKDIR /app/services/api
EXPOSE 3000
CMD ["node", "dist/index.js"]
