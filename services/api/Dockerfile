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
# Explicitly compile critical workspaces to guarantee dist output
RUN node_modules/.bin/tsc -p packages/shared/tsconfig.json \
 && node_modules/.bin/tsc -p packages/providers/tsconfig.json \
 && node_modules/.bin/tsc -p packages/db/tsconfig.json \
 && ls -l packages/shared/dist/index.js \
 && ls -l packages/db/dist/db/src/index.js
# Normalize providers build output path to expected location
RUN if [ -f packages/providers/dist/providers/src/index.js ]; then \
      mv packages/providers/dist/providers/src/index.* packages/providers/dist/ && \
      rm -rf packages/providers/dist/providers; \
    elif [ -f packages/providers/dist/src/index.js ]; then \
      mv packages/providers/dist/src/index.* packages/providers/dist/ && \
      rm -rf packages/providers/dist/src; \
    fi \
 && ls -l packages/providers/dist/index.js
RUN yarn workspaces foreach -A --topological-dev -j 1 run build
RUN yarn workspaces focus -A --production

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

# Ensure workspace modules resolve to source packages (avoid packed copies without dist)
RUN rm -rf node_modules/@ifi/providers node_modules/@ifi/shared node_modules/@ifi/db \
 && ln -s ../../packages/providers node_modules/@ifi/providers \
 && ln -s ../../packages/shared node_modules/@ifi/shared \
 && ln -s ../../packages/db node_modules/@ifi/db

# Verify internal workspace packages are present with built artifacts
RUN test -f /app/packages/providers/dist/index.js \
 && test -f /app/packages/shared/dist/index.js \
 && test -f /app/packages/db/dist/db/src/index.js \
 && test -e /app/node_modules/@ifi/providers/package.json \
 && test -e /app/node_modules/@ifi/shared/package.json \
 && test -e /app/node_modules/@ifi/db/package.json

ENV NODE_ENV=production
USER node
WORKDIR /app/services/api

EXPOSE 3000
CMD ["node", "dist/services/api/src/index.js"]
