#!/bin/sh
# Sauvegarde complète : base (à chaud) PUIS fichiers. A planifier chaque nuit (cron) :
#   30 2 * * *  /opt/isr-database/deploy/backup-linux.sh >> /var/log/isr-backup.log 2>&1
set -eu
APP="${APP:-/opt/isr-database}"
DATA="${ISR_DATA_DIR:-$APP/data}"
DEST="${DEST:-/mnt/sauvegarde-isr}"
cd "$APP"
node scripts/backup.js --keep=30
mkdir -p "$DEST"
rsync -a --delete "$DATA/backups/" "$DEST/backups/"
rsync -a --delete --exclude='*.part' "$DATA/storage/" "$DEST/storage/"
echo "$(date -Is) sauvegarde OK"
