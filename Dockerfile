# Alex API server — portable container. Builds the pnpm workspace and runs the
# self-contained esbuild bundle. Runs identically on Railway, a VPS, Fly, Render,
# Cloud Run, or locally. Config is entirely via environment variables.
# syntax=docker/dockerfile:1

# ---- build: install workspace deps and bundle the server ----
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app
COPY . .
# --no-frozen-lockfile: the committed lockfile's overrides section can mismatch
# the pnpm version in this image; let install reconcile rather than hard-fail.
RUN pnpm install --no-frozen-lockfile
RUN pnpm --filter @workspace/api-server build

# ---- runtime: just the self-contained bundle (same artifact Replit runs) ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/artifacts/api-server/dist ./dist
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
