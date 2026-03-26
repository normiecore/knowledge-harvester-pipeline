#!/bin/bash
set -e

echo "============================================"
echo "  🍄 Mycelium Pipeline — Starting Services"
echo "============================================"

# Load .env if it exists
if [ -f /app/.env ]; then
  export $(grep -v '^#' /app/.env | xargs)
fi

# Override service URLs for local mode
export NATS_URL="${NATS_URL:-nats://localhost:4222}"
export MUNINNDB_URL="${MUNINNDB_URL:-http://localhost:3030}"
export LLM_BASE_URL="${LLM_BASE_URL:-http://localhost:8000/v1}"
export LLM_MODEL="${LLM_MODEL:-meta-llama/Llama-3.1-8B-Instruct-AWQ}"

# ---- Start NATS ----
echo "[1/3] Starting NATS server..."
nats-server --jetstream --store_dir=/data/nats --port=4222 &
NATS_PID=$!

# Wait for NATS
for i in $(seq 1 30); do
  if curl -sf http://localhost:8222/healthz > /dev/null 2>&1; then
    echo "  ✓ NATS ready"
    break
  fi
  sleep 1
done

# ---- Start vLLM ----
echo "[2/3] Starting vLLM server (this may take a few minutes on first run)..."
python3 -m vllm.entrypoints.openai.api_server \
  --model "$LLM_MODEL" \
  --quantization awq \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.85 \
  --host 0.0.0.0 \
  --port 8000 &
VLLM_PID=$!

# Wait for vLLM (model download + load can take minutes)
echo "  Waiting for vLLM to load model..."
for i in $(seq 1 300); do
  if curl -sf http://localhost:8000/health > /dev/null 2>&1; then
    echo "  ✓ vLLM ready"
    break
  fi
  if [ $i -eq 300 ]; then
    echo "  ✗ vLLM failed to start after 5 minutes"
    exit 1
  fi
  sleep 1
done

# ---- Start Pipeline ----
echo "[3/3] Starting Mycelium pipeline..."
cd /app
node dist/src/main.js &
PIPELINE_PID=$!

# Wait for pipeline
for i in $(seq 1 30); do
  if curl -sf http://localhost:3001/api/health > /dev/null 2>&1; then
    echo "  ✓ Pipeline ready"
    break
  fi
  sleep 1
done

echo ""
echo "============================================"
echo "  🍄 Mycelium is running!"
echo "  UI:       http://localhost:3001"
echo "  API:      http://localhost:3001/api/health"
echo "  vLLM:     http://localhost:8000"
echo "  NATS:     nats://localhost:4222"
echo "============================================"
echo ""

# Handle shutdown
cleanup() {
  echo "Shutting down..."
  kill $PIPELINE_PID $VLLM_PID $NATS_PID 2>/dev/null
  wait
  echo "Shutdown complete"
}
trap cleanup SIGTERM SIGINT

# Keep running — wait for any process to exit
wait -n $NATS_PID $VLLM_PID $PIPELINE_PID
echo "A service exited unexpectedly. Shutting down..."
cleanup
