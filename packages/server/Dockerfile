FROM oven/bun:1-alpine AS base
WORKDIR /app

# Copy lockfile and workspace manifests first for cache
COPY package.json bun.lockb turbo.json tsconfig.base.json ./
COPY packages/crdt/package.json ./packages/crdt/package.json
COPY packages/server/package.json ./packages/server/package.json

# Install all workspace deps (crdt has no runtime deps, server has postgres)
RUN bun install --frozen-lockfile

# Copy source
COPY packages/crdt ./packages/crdt
COPY packages/server ./packages/server

EXPOSE 3001
CMD ["bun", "run", "packages/server/src/index.ts"]
