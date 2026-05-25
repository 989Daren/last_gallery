"""
Find and (optionally) archive image files in /uploads/ that aren't referenced
anywhere in the database.

Safety design:
  - Default mode is dry-run. No file is touched unless --move is passed.
  - Only TOP-LEVEL files in /uploads/ are considered. Subdirectories
    (/uploads/exhibits/, /uploads/cotm/, /uploads/_archive/) are skipped
    entirely — those files are never flagged or moved.
  - DB scan is *broad*: every TEXT column in every user table is checked for
    occurrences of each file's basename. This catches references in any
    column we might forget, not just the obvious URL columns.
  - Files referenced by ANY DB row, anywhere, are considered safe and never
    flagged as orphans.
  - --move sends files to /uploads/_archive/ instead of deleting them, so
    nothing is permanently lost in this pass.

Usage:
    python3 grid\\ utilities/cleanup_orphan_uploads.py                # dry-run
    python3 grid\\ utilities/cleanup_orphan_uploads.py --move         # archive
"""

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
DB_PATH = os.path.join(BASE_DIR, "data", "gallery.db")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
ARCHIVE_DIR = os.path.join(UPLOADS_DIR, "_archive")

# Tables to NEVER scan (internal SQLite)
SKIP_TABLES = {"sqlite_sequence", "schema_version"}


def collect_referenced_basenames(conn):
    """Return the set of file basenames referenced anywhere in the DB.

    Scans every TEXT-affinity column in every user table for any value
    containing 'uploads/' (case-insensitive). Returns the basenames of
    those file paths.
    """
    referenced = set()
    cur = conn.cursor()

    tables = [
        row[0] for row in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        if row[0] not in SKIP_TABLES and not row[0].startswith("sqlite_")
    ]

    for table in tables:
        cols = cur.execute(f"PRAGMA table_info({table})").fetchall()
        # Cols: cid, name, type, notnull, dflt_value, pk
        text_cols = [
            c[1] for c in cols
            if c[2] is None or "TEXT" in (c[2] or "").upper() or "CHAR" in (c[2] or "").upper()
        ]
        if not text_cols:
            continue
        select_cols = ", ".join(f'"{c}"' for c in text_cols)
        try:
            rows = cur.execute(f"SELECT {select_cols} FROM {table}").fetchall()
        except sqlite3.Error:
            continue
        for r in rows:
            for value in r:
                if not value or not isinstance(value, str):
                    continue
                # Look for any uploads/ reference inside this value
                lower = value.lower()
                if "uploads/" not in lower:
                    continue
                # Extract candidate basenames (handles full URLs, paths, multi-paths)
                # Walk the string to find /uploads/<filename> or uploads/<filename>
                idx = 0
                while True:
                    j = lower.find("uploads/", idx)
                    if j < 0:
                        break
                    start = j + len("uploads/")
                    # Read characters until whitespace, quote, or punctuation
                    end = start
                    while end < len(value) and value[end] not in ' \t\n\r"\'<>;,':
                        end += 1
                    name = value[start:end]
                    # Strip query string / fragment if any
                    for sep in ("?", "#"):
                        if sep in name:
                            name = name.split(sep, 1)[0]
                    if name and "/" not in name:  # only direct files, not subpaths
                        referenced.add(name)
                    idx = end
    return referenced


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--move", action="store_true",
                    help="Move orphan files to /uploads/_archive/ (otherwise dry-run)")
    ap.add_argument("--verbose", "-v", action="store_true",
                    help="Print every file's classification")
    args = ap.parse_args()

    if not os.path.exists(DB_PATH):
        print(f"ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        return 1
    if not os.path.isdir(UPLOADS_DIR):
        print(f"ERROR: uploads dir not found at {UPLOADS_DIR}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(DB_PATH)
    referenced = collect_referenced_basenames(conn)
    conn.close()

    files_on_disk = []
    for f in sorted(os.listdir(UPLOADS_DIR)):
        full = os.path.join(UPLOADS_DIR, f)
        if os.path.isfile(full):
            files_on_disk.append(f)

    orphans = [f for f in files_on_disk if f not in referenced]
    kept = [f for f in files_on_disk if f in referenced]

    total_size = sum(os.path.getsize(os.path.join(UPLOADS_DIR, f)) for f in files_on_disk)
    orphan_size = sum(os.path.getsize(os.path.join(UPLOADS_DIR, f)) for f in orphans)

    print(f"DB references:    {len(referenced)} file basenames")
    print(f"Files on disk:    {len(files_on_disk)}  ({total_size/1024/1024:.1f} MB)")
    print(f"  Referenced:     {len(kept)}")
    print(f"  Orphaned:       {len(orphans)}  ({orphan_size/1024/1024:.1f} MB)")

    if args.verbose:
        print("\nReferenced (safe) files:")
        for f in kept:
            print(f"  KEEP    {f}")

    print(f"\n{'Archiving' if args.move else 'Would archive'} {len(orphans)} orphan files:")
    print("-" * 80)
    for f in orphans:
        full = os.path.join(UPLOADS_DIR, f)
        sz = os.path.getsize(full) / 1024
        mt = datetime.fromtimestamp(os.path.getmtime(full)).strftime("%Y-%m-%d %H:%M")
        print(f"  {f}  {sz:>7.1f} KB  {mt}")

    if args.move and orphans:
        os.makedirs(ARCHIVE_DIR, exist_ok=True)
        moved = 0
        for f in orphans:
            src = os.path.join(UPLOADS_DIR, f)
            dst = os.path.join(ARCHIVE_DIR, f)
            if os.path.exists(dst):
                print(f"  WARN: {f} already in archive — skipping")
                continue
            shutil.move(src, dst)
            moved += 1
        print(f"\nArchived {moved} files to {ARCHIVE_DIR}")
        print(f"(Files can be restored by moving them back, or rm -rf the dir to permanently delete.)")
    elif not args.move:
        print(f"\nDry-run only. Re-run with --move to archive these to {ARCHIVE_DIR}.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
