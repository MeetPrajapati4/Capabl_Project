#!/usr/bin/env bash
# ==============================================================================
# healthcheck.sh — Production Health & Observability Verification Script
#
# Usage:
#   ./scripts/healthcheck.sh [--port <port>] [--timeout <seconds>]
# ==============================================================================

set -euo pipefail

PORT="${1:-7860}"
TIMEOUT="${2:-5}"
HOST="http://127.0.0.1:${PORT}"

echo "=============================================================="
echo "🩺 AskiFy AI Production Health & Observability Check"
echo "=============================================================="
echo "Connecting to: ${HOST}"

# 1. Check /healthz (Kubernetes / Standard Healthcheck)
echo -n "Checking GET /healthz ... "
if HEALTH_RESP=$(curl -s -S --max-time "${TIMEOUT}" "${HOST}/healthz" 2>/dev/null); then
  echo "✅ OK"
  echo "Response:"
  echo "${HEALTH_RESP}" | sed 's/^/  /'
else
  echo "❌ FAILED"
  echo "Error: Service at ${HOST}/healthz did not respond within ${TIMEOUT}s."
  exit 1
fi

echo ""

# 2. Check /api/metrics (Observability Metrics)
echo -n "Checking GET /api/metrics ... "
if METRICS_RESP=$(curl -s -S --max-time "${TIMEOUT}" "${HOST}/api/metrics" 2>/dev/null); then
  echo "✅ OK"
  echo "Current Metrics Summary:"
  echo "${METRICS_RESP}" | sed 's/^/  /'
else
  echo "⚠️ Warning: Could not fetch metrics endpoint."
fi

echo ""
echo "=============================================================="
echo "✨ System is healthy and ready to serve PhD research inquiries."
echo "=============================================================="
exit 0
