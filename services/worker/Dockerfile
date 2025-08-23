FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy workspace manifests
COPY package.json yarn.lock .yarnrc.yml ./
COPY tsconfig.base.json ./

# Copy only needed packages and worker service
COPY packages ./packages
COPY services/db ./services/db
COPY services/worker ./services/worker

# Install deps (node-modules linker per .yarnrc.yml)
RUN yarn install

# Generate Prisma client for db package
RUN yarn workspace @ifi/db prisma generate

# Build in topological order to ensure deps are compiled before dependents
RUN yarn workspace @ifi/shared build \
    && yarn workspace @ifi/db build \
    && yarn workspace @ifi/worker build

# ---- Runtime ----
FROM node:20-slim
WORKDIR /app

# Prisma needs OpenSSL at runtime
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy production dependencies and artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/db ./services/db
COPY --from=builder /app/services/worker/package.json ./services/worker/package.json
COPY --from=builder /app/services/worker/dist ./services/worker/dist

ENV NODE_ENV=production
USER node
WORKDIR /app/services/worker

CMD ["node", "dist/index.js"]
