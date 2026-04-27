FROM node:20-bookworm-slim

ARG RAILPACK_VERSION=0.15.1

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    gzip \
    make \
    g++ \
    python3 \
    tar \
    unzip \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
  && chmod a+r /etc/apt/keyrings/docker.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends docker-buildx-plugin docker-ce-cli \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://railpack.com/install.sh | RAILPACK_VERSION=${RAILPACK_VERSION} sh -s -- --bin-dir /usr/local/bin

WORKDIR /workspace

COPY . .

RUN pnpm install --frozen-lockfile --filter @brimble/api...
RUN pnpm --filter @brimble/api run build

RUN docker --version \
  && docker buildx version \
  && railpack --version \
  && git --version

ENV NODE_ENV=production
ENV APP_PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 CMD curl -fsS http://127.0.0.1:3001/api/health >/dev/null || exit 1

CMD ["node", "apps/api/dist/src/index.js"]
