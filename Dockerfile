# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# `.npmrc` turns dependency lifecycle scripts off, so npm's implicit
# `node-gyp rebuild` for better-sqlite3 (binding.gyp without an install script)
# never runs here — the client/server build needs no compiled dependency.
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Serve stage
FROM node:22-alpine
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Script-free install (`.npmrc`): better-sqlite3 ships musl prebuilds, so the
# runtime binary comes straight out of the package and no python3/build-base
# toolchain has to be installed — or compiled away again — in this stage.
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist-server/server/index.js"]
