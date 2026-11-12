FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

# Cache dependency installation independently of application changes.
# Current production packages need no lifecycle scripts (Scarf telemetry is skipped).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

# Explicit runtime paths plus the context allowlist keep local data out of layers.
COPY server.js ./
COPY config/ ./config/
COPY controllers/ ./controllers/
COPY middleware/ ./middleware/
COPY models/ ./models/
COPY routes/ ./routes/
COPY services/ ./services/
COPY utils/ ./utils/
COPY validators/ ./validators/
COPY chat_bot/ ./chat_bot/
COPY scripts/check-config.js scripts/docker-healthcheck.js ./scripts/

# Source/dependencies remain root-owned; only temporary uploads are writable.
RUN mkdir -p /app/uploads \
    && chown node:node /app/uploads \
    && chmod 0750 /app/uploads

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD ["node", "scripts/docker-healthcheck.js"]

CMD ["node", "server.js"]
