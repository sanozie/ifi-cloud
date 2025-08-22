FROM node:20-slim AS builder
WORKDIR /app
RUN corepack enable

# Copy monorepo (enough for Yarn workspaces)
COPY package.json yarn.lock .yarnrc.yml ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services ./services

# Install deps without running lifecycle scripts
RUN YARN_ENABLE_SCRIPTS=false yarn install

# Generate Prisma client and build all workspaces
RUN yarn workspace @ifi/db prisma generate
RUN yarn workspace @ifi/shared build \
    && yarn workspace @ifi/db build \
    && yarn workspace @ifi/api build

RUN ls -la /app/services/api/
RUN ls -la /app/services/api/dist/ || echo "dist directory not found"

# --- Runtime ---
FROM oven/bun:1

# Set working directory for the runtime image
WORKDIR /app

# Prisma requires OpenSSL at runtime in Debian-based images (bun image is debian-based)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Copy production artifacts from the builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/api/package.json ./services/api/package.json
COPY --from=builder /app/services/api/dist ./services/api/dist

# Environment configuration
ENV NODE_ENV=production

# Switch to non-root bun user provided by the image
USER bun

# Move into the API service directory for execution
WORKDIR /app/services/api

# Expose application port
EXPOSE 3000

# Start the Elysia server with Bun
CMD ["bun", "dist/index.js"]
