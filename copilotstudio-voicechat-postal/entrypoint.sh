#!/bin/sh
set -e

# Start the Node token broker in the background
echo "Starting token broker on :3000..."
cd /app/server
node server.js &
BROKER_PID=$!

# Trap signals so nginx + node shut down together
term_handler() {
  echo "Stopping broker (pid=$BROKER_PID)..."
  kill -TERM "$BROKER_PID" 2>/dev/null || true
  exit 0
}
trap term_handler TERM INT

# Run nginx in the foreground (PID 1 -> handled by Docker)
echo "Starting nginx..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Wait on either; if one exits, propagate
wait -n "$BROKER_PID" "$NGINX_PID"
EXIT=$?
echo "Process exited with $EXIT, shutting down..."
kill -TERM "$BROKER_PID" "$NGINX_PID" 2>/dev/null || true
exit $EXIT
