#!/bin/bash
set -e

echo "=== GridScope NY Startup ==="

# Start FastAPI backend from backend/ so relative imports resolve correctly
cd backend
python3 -m uvicorn api.main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd ..
echo "Backend started (PID $BACKEND_PID)"

# Wait for backend health check
MAX_WAIT=30
WAITED=0
echo "Waiting for backend on /api/health..."
while [ $WAITED -lt $MAX_WAIT ]; do
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "ERROR: Backend process exited unexpectedly."
    exit 1
  fi
  if curl -sf http://localhost:8000/api/health > /dev/null 2>&1; then
    echo "Backend healthy after ${WAITED}s"
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "ERROR: Backend did not become healthy within ${MAX_WAIT}s"
  kill $BACKEND_PID 2>/dev/null || true
  exit 1
fi

echo "Starting frontend..."
cd frontend && pnpm dev
