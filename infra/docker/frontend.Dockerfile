FROM node:20-bookworm-slim AS build

ARG VITE_API_BASE=/api

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV VITE_API_BASE=$VITE_API_BASE

RUN corepack enable

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile --filter @brimble/web...
RUN pnpm --filter @brimble/web run build

FROM nginx:1.27-alpine

COPY infra/docker/frontend.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html

HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=6 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
