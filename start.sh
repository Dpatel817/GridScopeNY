#!/bin/bash
# Start FastAPI backend in background, then start React frontend in foreground
uvicorn api:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
echo "API backend started (PID $BACKEND_PID)"
# Wait for API to be ready
sleep 3
# Start React frontend
cd frontend && npm run dev
