#!/usr/bin/env bash
# ==============================================================================
# export_backup.sh — Production Data & Cache Backup Script
#
# Creates a timestamped archive of the application's vector stores,
# query caches, and document metadata for disaster recovery.
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${1:-./data/backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TARGET_ARCHIVE="${BACKUP_DIR}/askify_backup_${TIMESTAMP}.tar.gz"

echo "=============================================================="
echo "📦 AskiFy AI Academic Data & Vector Store Backup"
echo "=============================================================="

mkdir -p "${BACKUP_DIR}"

if [ ! -d "./data" ]; then
  echo "⚠️ Warning: ./data directory not found in current working directory."
  exit 1
fi

echo "Archiving query cache and indexed document metadata..."

tar --exclude="*.log" \
    --exclude="backups" \
    -czf "${TARGET_ARCHIVE}" ./data 2>/dev/null || {
      # Fallback for systems without tar flags
      tar -czf "${TARGET_ARCHIVE}" ./data
    }

if [ -f "${TARGET_ARCHIVE}" ]; then
  FILE_SIZE=$(du -h "${TARGET_ARCHIVE}" | cut -f1)
  echo "✅ Backup successfully created at: ${TARGET_ARCHIVE} (${FILE_SIZE})"
else
  echo "❌ Error: Failed to generate backup archive."
  exit 1
fi

echo "=============================================================="
echo "✨ Backup procedure complete."
echo "=============================================================="
exit 0
