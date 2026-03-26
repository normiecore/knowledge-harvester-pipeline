#!/bin/bash
# Mycelium Pipeline — RunPod direct setup (no Docker needed)
# Run this once on a fresh RunPod pod to install deps and start everything
set -e

echo "============================================"
echo "  🍄 Mycelium — RunPod Setup"
echo "============================================"

cd /workspace/dgx-mycelium-pipeline-ui

# ---- Install system deps ----
echo "[1/5] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq curl wget > /dev/null 2>&1

# ---- Install Node.js 22 ----
echo "[2/5] Installing Node.js 22..."
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
  apt-get install -y -qq nodejs > /dev/null 2>&1
fi
echo "  ✓ Node $(node --version)"

# ---- Install NATS server ----
echo "[3/5] Installing NATS server..."
if ! command -v nats-server &> /dev/null; then
  curl -sL https://github.com/nats-io/nats-server/releases/download/v2.10.24/nats-server-v2.10.24-linux-amd64.tar.gz | tar xz
  mv nats-server-v2.10.24-linux-amd64/nats-server /usr/local/bin/
  rm -rf nats-server-v2.10.24-linux-amd64
fi
echo "  ✓ NATS $(nats-server --version)"

# ---- Install vLLM ----
echo "[4/5] Installing vLLM (this takes a few minutes)..."
pip install --no-cache-dir vllm > /dev/null 2>&1
echo "  ✓ vLLM installed"

# ---- Build pipeline + frontend ----
echo "[5/5] Building pipeline and frontend..."
npm ci --silent
npm run build

cd frontend
npm ci --silent
npm run build
cd ..

echo ""
echo "============================================"
echo "  ✓ Setup complete!"
echo ""
echo "  To start Mycelium, run:"
echo "    cd /workspace/dgx-mycelium-pipeline-ui"
echo "    bash start.sh"
echo ""
echo "  Make sure .env exists first!"
echo "============================================"
