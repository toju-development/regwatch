# syntax=docker/dockerfile:1
# ── Stage 1: Base ────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# ── Stage 2: Install all dependencies ────────────────────────────────────────
FROM base AS installer
WORKDIR /app

# Copy workspace manifests only (for cache efficiency)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/config/package.json ./packages/config/
COPY packages/db/package.json ./packages/db/
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile

# ── Stage 3: Generate Prisma client ──────────────────────────────────────────
FROM installer AS generator
WORKDIR /app

COPY packages/db/prisma ./packages/db/prisma
RUN pnpm -F @regwatch/db db:generate

# ── Stage 4: Production isolation via pnpm deploy ────────────────────────────
FROM generator AS deployer
WORKDIR /app

# Copy all workspace source (needed so pnpm deploy can bundle workspace packages)
COPY packages/ ./packages/
COPY apps/api/src ./apps/api/src

# pnpm deploy copies the app + its prod node_modules (including workspace deps)
# into /deploy, which becomes the self-contained production directory.
RUN pnpm deploy --filter=@regwatch/api --prod /deploy

# ── Stage 5: Production runner ───────────────────────────────────────────────
FROM node:22-alpine AS runner

# tsx is required at runtime because @regwatch/* packages are published as TypeScript source.
# Installing globally keeps it separate from the application's node_modules.
RUN npm install -g tsx@4.19.2

WORKDIR /app

# Copy the isolated production directory
COPY --from=deployer /deploy .

# Copy Prisma schema and migrations so `prisma migrate deploy` can run.
# Migrations are run as a pre-deploy Cloud Run Job — see DEPLOYMENT.md.
COPY --from=generator /app/packages/db/prisma ./prisma

COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
