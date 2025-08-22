FROM node:20-slim AS builder

# Enable corepack for Yarn
RUN corepack enable

# Set working directory
WORKDIR /app

# Copy entire repo (simpler, preserves workspace graph)
COPY . .

# Install all workspace deps without running lifecycle scripts
RUN YARN_ENABLE_SCRIPTS=false yarn install --immutable

# Generate Prisma client
RUN yarn workspace @ifi/db run prisma generate

# Build all packages
RUN yarn build

# Production image
FROM node:20-slim

# Enable corepack for Yarn
RUN corepack enable

# Set working directory
WORKDIR /app

# Copy package.json and yarn config
#   – root manifests
COPY package.json yarn.lock .yarnrc.yml ./
#   – workspaces needed at runtime
COPY packages ./packages
COPY services ./services

# Install production dependencies only
RUN YARN_ENABLE_SCRIPTS=false yarn workspaces focus @ifi/api --production

# Copy built files from builder stage
COPY --from=builder /app/packages/*/dist ./packages/
COPY --from=builder /app/services/api/dist ./services/api/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Copy generated Prisma client JS files as well
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Verify that the compiled entrypoint exists
RUN test -f ./services/api/dist/index.js || test -f ./services/api/dist/src/index.js

# Ensure runtime user owns all files
RUN chown -R node:node /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Run as non-root user
USER node

# Switch to service directory and start API server
WORKDIR /app/services/api
CMD ["sh", "-lc", "node dist/index.js 2>/dev/null || node dist/src/index.js"]
