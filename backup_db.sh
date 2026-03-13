#!/bin/bash
# Backup gallery.db with timestamp, keep last 20 copies
# Runs via systemd timer (backup-db.timer)

BACKUP_DIR="/home/daren/last_gallery/data/backups"
DB_PATH="/home/daren/last_gallery/data/gallery.db"
MAX_BACKUPS=20

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/gallery_${TIMESTAMP}.db"

# Use sqlite3 .backup for a safe, consistent copy (no locking issues)
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

if [ $? -eq 0 ]; then
    echo "Backup created: $BACKUP_FILE"
else
    echo "ERROR: Backup failed" >&2
    exit 1
fi

# Remove oldest backups beyond MAX_BACKUPS
ls -1t "$BACKUP_DIR"/gallery_*.db 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm --
echo "Backups retained: $(ls -1 "$BACKUP_DIR"/gallery_*.db 2>/dev/null | wc -l)/$MAX_BACKUPS"

# Copy to PC shared folder if mounted
PC_BACKUP_DIR="/home/daren/pc/gallery_db_backups"
if mountpoint -q /home/daren/pc 2>/dev/null; then
    mkdir -p "$PC_BACKUP_DIR"
    cp "$BACKUP_FILE" "$PC_BACKUP_DIR/"
    ls -1t "$PC_BACKUP_DIR"/gallery_*.db 2>/dev/null | tail -n +$((MAX_BACKUPS + 1)) | xargs -r rm --
    echo "PC copy: $PC_BACKUP_DIR/gallery_${TIMESTAMP}.db"
else
    echo "WARNING: ~/pc not mounted, skipping PC copy"
fi
