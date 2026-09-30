# Multi-stage build for the web app and the Caddy reverse proxy. The final
# image is Caddy with the web build inside it, so one image serves the
# static files and proxies the API.
# Build it from the repository root: docker build -f apps/web/Dockerfile .

FROM node:24-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/client-core/package.json packages/client-core/package.json
COPY packages/crypto-wasm/package.json packages/crypto-wasm/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @discord-clone/web...
COPY tsconfig.base.json tsconfig.base.json
COPY packages/shared packages/shared
COPY packages/client-core packages/client-core
# The crypto WASM is built ahead of time and kept in packages/crypto-wasm/pkg.
COPY packages/crypto-wasm/pkg packages/crypto-wasm/pkg
COPY apps/web apps/web
# Run the type check and the bundler as two steps. Do not use the "build"
# script, so the image build has the same result in every place.
RUN pnpm --filter @discord-clone/web exec tsc --noEmit \
  && pnpm --filter @discord-clone/web exec vite build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
