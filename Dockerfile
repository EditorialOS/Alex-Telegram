# Alex Core local/CI parity container. Vercel is the production target.
# The image includes the manifest-verified, vendored Alex source; Eve is not a
# runtime dependency.
# syntax=docker/dockerfile:1

# ---- build: install workspace dependencies and bundle the server ----
FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @workspace/api-server test
RUN pnpm --filter @workspace/api-server build

# ---- runtime: bundled server plus verified filesystem source ----
FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/sources ./sources
COPY --from=build /app/story-desk ./story-desk
COPY --from=build /app/alex-source.lock.json ./alex-source.lock.json
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/story-desk.mjs"]
