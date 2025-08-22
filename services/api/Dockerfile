FROM node:20-slim AS builder
WORKDIR /app

# Enable Corepack to ensure the right Yarn version is available
RUN corepack enable

# Install dependencies with Yarn (copies lockfile if present)
COPY package.json .yarnrc.yml yarn.lock* ./
RUN yarn install

# Build TypeScript sources
COPY tsconfig.json ./
COPY src ./src
RUN yarn build

# --- Runtime image ---
FROM node:20-slim
WORKDIR /app

# Production environment
ENV NODE_ENV=production

# Copy runtime essentials
COPY package.json .
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Expose port expected by Render
EXPOSE 3000

# Start the server
CMD ["node", "dist/index.js"]
