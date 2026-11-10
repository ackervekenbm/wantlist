# syntax=docker/dockerfile:1

# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# `.npmrc` turns dependency lifecycle scripts off, so npm's implicit
# `node-gyp rebuild` for better-sqlite3 never runs: no toolchain needed.
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Production dependencies only. better-sqlite3 ships musl prebuilds for amd64
# and arm64, so the native binary comes straight out of the package.
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Runs as root, like jukebox: an existing data volume or OMV host folder is
# root-owned, and a non-root user could not open the database in it.
RUN mkdir -p /app/data

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

EXPOSE 3000
CMD ["node", "dist-server/server/index.js"]
