"""
Cleanup expired unpaid artwork.

Runs daily at midnight UTC via systemd timer.
Removes artwork that has an expired payment_deadline and is still unlocked=0.
The artist's free (first) tile is never affected — only 2nd+ uploads with deadlines.
"""

import os
import sqlite3

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "gallery.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")


def cleanup():
    if not os.path.exists(DB_PATH):
        print("[CLEANUP] Database not found, nothing to do.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # Find expired unpaid artwork
    cursor.execute("""
        SELECT asset_id, tile_url, popup_url, contact1_value, artwork_title
        FROM assets
        WHERE payment_deadline IS NOT NULL
          AND payment_deadline < datetime('now')
          AND unlocked = 0
          AND asset_type = 'artwork'
    """)
    expired = cursor.fetchall()

    if not expired:
        print("[CLEANUP] No expired artwork found.")
        conn.close()
        return

    print(f"[CLEANUP] Found {len(expired)} expired artwork(s) to remove.")

    for row in expired:
        asset_id = row["asset_id"]
        title = row["artwork_title"] or "(untitled)"
        email = row["contact1_value"] or "(no email)"
        print(f"  Removing asset {asset_id}: \"{title}\" ({email})")

        # Delete uploaded image files
        for url_field in ("tile_url", "popup_url"):
            url = row[url_field] or ""
            if url.startswith("/uploads/"):
                filename = url.split("/uploads/", 1)[1]
                filepath = os.path.join(UPLOAD_DIR, filename)
                try:
                    if os.path.exists(filepath):
                        os.remove(filepath)
                        print(f"    Deleted file: {filename}")
                except Exception as e:
                    print(f"    Warning: could not delete {filename}: {e}")

        # Clear tile assignment
        cursor.execute(
            "UPDATE tiles SET asset_id = NULL, updated_at = datetime('now') WHERE asset_id = ?",
            (asset_id,)
        )

        # Delete the asset
        cursor.execute("DELETE FROM assets WHERE asset_id = ?", (asset_id,))

        # Clean up orphaned edit codes
        normalized_email = (row["contact1_value"] or "").strip().lower()
        if normalized_email:
            cursor.execute(
                "SELECT COUNT(*) FROM assets WHERE LOWER(TRIM(contact1_value)) = ?",
                (normalized_email,)
            )
            remaining = cursor.fetchone()[0]
            if remaining == 0:
                cursor.execute("DELETE FROM edit_codes WHERE email = ?", (normalized_email,))
                print(f"    Cleaned up orphaned edit code for {normalized_email}")

    conn.commit()
    conn.close()
    print(f"[CLEANUP] Done. Removed {len(expired)} expired artwork(s).")


if __name__ == "__main__":
    cleanup()
