FROM node:20-slim AS builder
WORKDIR /app

# Copy only the worker sources and tsconfig
COPY services/worker/tsconfig.json ./services/worker/tsconfig.json
COPY services/worker/src ./services/worker/src

# Compile TypeScript using a one-off Typescript install (no workspace deps)
RUN npx -y typescript@5.5.4 tsc -p services/worker/tsconfig.json

# ---- Runtime ----
FROM node:20-slim
WORKDIR /app/services/worker

# Copy compiled output
COPY --from=builder /app/services/worker/dist ./dist

ENV NODE_ENV=production
USER node

CMD ["node", "dist/index.js"]
