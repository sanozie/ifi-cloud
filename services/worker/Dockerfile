FROM node:20-slim AS builder

# Enable corepack for Yarn
RUN corepack enable

# Set working directory
WORKDIR /app

# Copy package.json, yarn.lock and workspace configs
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/*/package.json ./packages/
COPY services/*/package.json ./services/

# Install dependencies
RUN YARN_ENABLE_SCRIPTS=false yarn install --immutable

# Copy source code
COPY . .

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
COPY package.json yarn.lock .yarnrc.yml ./
COPY packages/*/package.json ./packages/
COPY services/*/package.json ./services/

# Install production dependencies only
RUN YARN_ENABLE_SCRIPTS=false yarn workspaces focus --all --production

# Copy built files from builder stage
COPY --from=builder /app/packages/*/dist ./packages/
COPY --from=builder /app/services/worker/dist ./services/worker/dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Set environment variables
ENV NODE_ENV=production

# Run as non-root user
USER node

# Start worker service
CMD ["node", "services/worker/dist/index.js"]
