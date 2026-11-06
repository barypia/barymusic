# Zależności backendu
FROM node:22.23.2-alpine AS dependencies

RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# Build metadata is generated from values supplied by the local build wrapper.
FROM node:22.23.2-alpine AS build-info
WORKDIR /source
COPY scripts/generate-build-info.js ./scripts/generate-build-info.js
COPY server/package.json ./server/package.json
ARG BARYMUSIC_BUILD_COMMIT
ARG BARYMUSIC_BUILD_DIRTY
ENV BARYMUSIC_BUILD_COMMIT=${BARYMUSIC_BUILD_COMMIT} \
    BARYMUSIC_BUILD_DIRTY=${BARYMUSIC_BUILD_DIRTY}
RUN node scripts/generate-build-info.js --from-env server/build-info.json

# Obraz aplikacji
FROM node:22.23.2-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BARYMUSIC_HOME=/var/lib/barymusic

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --chown=node:node server/barymusic.js server/song-metadata.js server/package.json ./
COPY --from=build-info --chown=node:node /source/server/build-info.json ./build-info.json
COPY --chown=node:node frontend ./frontend

RUN mkdir -p /var/lib/barymusic/config /var/lib/barymusic/data/audio /var/lib/barymusic/data/notes /var/lib/barymusic/logs \
    && chown -R node:node /var/lib/barymusic \
    && chown node:node /app \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx

USER node

VOLUME ["/var/lib/barymusic"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000)).then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "barymusic.js"]
