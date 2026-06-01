# Multi-stage: install Node deps, then assemble a single image running both
# the Node token broker and nginx (via a small entrypoint script).

# --- Stage 1: install server dependencies ---
FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY server/server.js ./

# --- Stage 2: runtime image (nginx + node) ---
FROM nginx:alpine

# Install Node.js (alpine ships nodejs-current via apk)
RUN apk add --no-cache nodejs

# Static frontend
COPY public/ /usr/share/nginx/html/

# Token broker
COPY --from=server-build /app/server /app/server

# nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Entrypoint that starts broker + nginx
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

CMD ["/entrypoint.sh"]
