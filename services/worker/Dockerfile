FROM node:20-slim AS builder

# Enable corepack for Yarn
RUN corepack enable

# Set working directory
WORKDIR /app

# Copy entire repo (preserves workspace graph for Yarn)
COPY . .

# Install all workspace dependencies without running lifecycle scripts
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
RUN YARN_ENABLE_SCRIPTS=false yarn workspaces focus @ifi/worker --production

# Copy built files from builder stage
COPY --from=builder /app/packages/*/dist ./packages/
COPY --from=builder /app/services/worker/dist ./services/worker/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Copy generated Prisma client JS files as well
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Set environment variables
ENV NODE_ENV=production

# Run as non-root user
USER node

# Start worker service
CMD ["node", "services/worker/dist/index.js"]
