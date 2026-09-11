# syntax=docker/dockerfile:1
# Verified multi-platform Node 24.20.0 release index. Update tag and digest together.
FROM --platform=$BUILDPLATFORM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY index.html tokens.css tsconfig.json vite.config.ts LICENSE THIRD_PARTY_NOTICES.md ./
COPY src ./src
COPY server ./server
COPY public ./public
COPY scripts/licenses.mjs scripts/precompress.mjs ./scripts/
# Public repository metadata only. Never pass credentials as build arguments.
ARG CHAINGRAPH_SOURCE_URL=""
RUN CHAINGRAPH_SOURCE_URL="$CHAINGRAPH_SOURCE_URL" npm run build \
    && npm exec --no -- esbuild server/index.ts --bundle --platform=node --target=node24 --format=cjs --outfile=build/server.cjs \
    && npm run licenses

FROM node:24.20.0-bookworm-slim@sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production SERVER_HOST=0.0.0.0 SERVER_PORT=3000 CHAINGRAPH_NETWORK_CONFIG_DIR=/run/chaingraph
ARG CHAINGRAPH_SOURCE_URL=""
ARG VCS_REF=""
LABEL org.opencontainers.image.title="Chaingraph" \
      org.opencontainers.image.description="Self-hosted Bitcoin wallet and chain analysis workbench" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="$CHAINGRAPH_SOURCE_URL" \
      org.opencontainers.image.revision="$VCS_REF"
COPY --from=build /app/build/server.cjs ./server.cjs
COPY --from=build /app/dist ./dist
COPY --from=build /app/LICENSE /app/THIRD_PARTY_NOTICES.md /app/package.json /app/package-lock.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e 'fetch(`http://127.0.0.1:${process.env.SERVER_PORT || 3000}/`, {method:"HEAD", signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'
CMD ["node", "--use-system-ca", "server.cjs"]
