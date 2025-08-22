FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable

# Copy monorepo (enough for Yarn workspaces)
COPY package.json yarn.lock .yarnrc.yml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services ./services

# Install deps without running lifecycle scripts
RUN YARN_ENABLE_SCRIPTS=false yarn install --immutable

# Generate Prisma client and build all workspaces
RUN yarn workspace @ifi/db prisma generate
RUN yarn workspace @ifi/shared build \
    && yarn workspace @ifi/db build \
    && yarn workspace @ifi/worker build

# --- Runtime ---
FROM node:20-slim
WORKDIR /app

# Prisma requires OpenSSL at runtime in Debian-based images
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy production artifacts and dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/worker/package.json ./services/worker/package.json
COPY --from=builder /app/services/worker/dist ./services/worker/dist

ENV NODE_ENV=production
USER node
WORKDIR /app/services/worker
CMD ["node", "dist/index.js"]
