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
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

# ── Stage 3: Build Next.js app ───────────────────────────────────────────────
FROM installer AS builder
WORKDIR /app

# Copy all workspace source
COPY packages/ ./packages/
COPY apps/web/ ./apps/web/

# Generate Prisma client (apps/web depends on @regwatch/db for auth adapter)
COPY packages/db/prisma ./packages/db/prisma
RUN pnpm -F @regwatch/db db:generate

# Build Next.js with standalone output.
# SKIP_ENV_VALIDATION=1 bypasses t3-env validation so the build doesn't require
# real secrets — identical to the pattern used in the CI quality job.
ENV SKIP_ENV_VALIDATION=1
RUN pnpm -F @regwatch/web build

# ── Stage 4: Production runner ───────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# The standalone output bundles everything needed to run the server.
# Static assets must be copied alongside the standalone folder.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

# Next.js standalone entry point.
# In a pnpm monorepo, the server.js is located inside the app subdirectory
# within the standalone output.
CMD ["node", "apps/web/server.js"]
