# syntax=docker/dockerfile:1
FROM node:22.23.3-trixie-slim AS build
WORKDIR /app
RUN mkdir -p /usr/share/man/man1 && apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git make python3 unzip xz-utils libglu1-mesa openjdk-21-jre-headless \
    && rm -rf /var/lib/apt/lists/*
ENV PUB_CACHE=/app/.cache/pub \
    FIREBASE_EMULATORS_PATH=/app/.cache/firebase/emulators \
    npm_config_cache=/app/.cache/npm \
    FLUTTER_BIN=/app/.tools/flutter/bin/flutter \
    CI=true
COPY package.json package-lock.json ./
COPY functions/package.json functions/package-lock.json ./functions/
RUN test "$(npm --version)" = 10.9.9 \
    && npm ci --no-fund --no-audit && npm --prefix functions ci --no-fund --no-audit
RUN git clone --depth 1 --branch 3.47.2 https://github.com/flutter/flutter.git .tools/flutter \
    && test "$(git -C .tools/flutter rev-parse HEAD)" = d3b14c876900e553bc736ca19295fc09e3853e8e \
    && .tools/flutter/bin/flutter --disable-analytics \
    && .tools/flutter/bin/flutter precache --web --linux \
    && ./node_modules/.bin/firebase setup:emulators:firestore \
    && ./node_modules/.bin/firebase setup:emulators:storage
COPY . .
RUN node scripts/setup_flutter.js
RUN make test && npm run test:flutter

# A public key, not a secret. No payment/QR/server credentials belong in an image.
ARG FIREBASE_APP_CHECK_WEB_KEY=
ENV FIREBASE_APP_CHECK_WEB_KEY=$FIREBASE_APP_CHECK_WEB_KEY
RUN npm run build:web

FROM build AS checks
CMD ["make", "test-all"]

FROM node:22.23.3-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 PUBLIC_DIR=/app/dist/site
COPY --from=build --chown=node:node /app/dist/site ./dist/site
COPY --chown=node:node server.js web-public.js ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "require('node:http').get('http://127.0.0.1:8080/',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
