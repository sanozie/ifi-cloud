FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable

# Copy monorepo (enough for Yarn workspaces)
COPY package.json yarn.lock .yarnrc.yml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services ./services

# Install deps
# Immutable install for reproducible builds
RUN yarn install --immutable

# Generate Prisma client, then build all workspaces topologically and focus
RUN yarn workspace @ifi/db prisma generate
RUN yarn workspaces foreach -A --topological-dev -j 1 run build
RUN yarn workspaces focus @ifi/api --production

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
CMD ["node", "dist/services/api/src/index.js"]
