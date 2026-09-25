FROM node:24.21.0-trixie-slim@sha256:db3ae80f5d8df06e04dabdf7b44cbf008d32de168205fa0294444aabbc08c590 AS node

FROM node AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# All required runtime peers are declared dependencies. Do not auto-install
# Better Auth's optional Vitest peer; retain Sharp's native optional dependencies.
RUN npm ci --omit=dev --legacy-peer-deps --ignore-scripts
COPY --from=build /app/dist/server ./dist/server
COPY --from=build /app/dist/self-hosted ./dist/self-hosted
COPY drizzle ./drizzle
COPY db/self-hosted ./db/self-hosted
COPY LICENSE THIRD-PARTY-NOTICES.md THIRD-PARTY-SOURCES.md ./
COPY licenses ./licenses
COPY scripts/build-notices.mjs ./scripts/build-notices.mjs
RUN node scripts/build-notices.mjs runtime
# Source-only exports can have private host permissions. Normalize only shipped
# application files here; installation data is never part of this stage.
RUN chmod -R u=rwX,go=rX /app

FROM debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132 AS runtime
# Refresh OS security updates at build time. Record the final image's package inventory.
RUN apt-get update \
    && apt-get upgrade -y \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates libatomic1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --shell /bin/sh --create-home node \
    && mkdir /data && chown node:node /data \
    # A web-service image needs no setuid/setgid programs, even when a host
    # cannot set no-new-privileges. Keep ordinary shell/tar recovery commands.
    && find /usr -xdev -type f -perm /6000 -exec chmod a-s {} +
# Copy only Node and its notices: no npm, Corepack, Yarn, headers or install cache.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/LICENSE /usr/local/LICENSE
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
WORKDIR /app
COPY --from=dependencies /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "dist/server/healthcheck.mjs"]
CMD ["node", "dist/server/index.mjs"]
