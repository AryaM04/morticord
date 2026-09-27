# Multi-stage build for the server. The final image holds only production
# dependencies and compiled output, to keep the image small.

FROM node:24-alpine AS base
WORKDIR /repo
RUN corepack enable

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --frozen-lockfile
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY tsconfig.base.json tsconfig.base.json
RUN pnpm --filter @discord-clone/shared build
RUN pnpm --filter @discord-clone/server build
RUN pnpm --filter @discord-clone/server deploy --prod /out/server

FROM base AS runtime
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build /out/server/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/server/package.json ./package.json
USER app
EXPOSE 3000
CMD ["node", "dist/index.js"]
