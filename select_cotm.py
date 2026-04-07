"""
Select Creator of the Month.

Runs on the 1st of each month via systemd timer.
Picks a random eligible artist (unlocked artwork, not admin, not a winner
in the last 5 months) and inserts them as COTM. Sends congratulations email.

Skips if the current month already has a COTM selected less than 25 days ago
(i.e., admin manually picked one).
"""

import html
import os
import random
import sqlite3
from datetime import datetime, timezone
from urllib.parse import quote

import resend
from dotenv import load_dotenv

# ---- Config ----
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "data", "gallery.db")

load_dotenv(os.path.join(BASE_DIR, ".env"))

BASE_URL = os.environ.get("TLG_BASE_URL", "https://thelastgallery.com")
ADMIN_ARTIST_NAME = "Daren Daniels"
COOLDOWN_MONTHS = 5

EMAIL_LOGO_HTML = (
    f'<img src="{BASE_URL}/static/images/logo_email.png" alt="The Last Gallery" '
    'width="112" height="111" style="display:block; margin:0 0 20px 0;" />'
)


def send_cotm_email(email, artist_name, edit_code):
    """Send congratulations email to the new COTM."""
    api_key = os.environ.get("RESEND_API_KEY")
    if not api_key:
        print(f"[COTM] RESEND_API_KEY not set — email not sent. To: {email}")
        return

    safe_name = html.escape(artist_name)
    safe_code = html.escape(edit_code)
    profile_link = f"{BASE_URL}/creator-of-the-month?code={quote(edit_code, safe='')}"

    html_body = (
        '<div style="font-family:sans-serif; max-width:520px; margin:0 auto; padding:20px;">'
        f'{EMAIL_LOGO_HTML}'
        f'<h2 style="color:#D4A843;">Congratulations, {safe_name}!</h2>'
        '<p style="font-size:18px;">You\'ve been selected as <strong>The Last Gallery\'s '
        'Creator of the Month!</strong></p>'
        '<p>Your artwork is now featured in a special spotlight seen by every visitor to the gallery.</p>'
        '<p style="margin-top:16px; padding:12px; background:#1a1a1a; border:1px solid #D4A843; '
        'border-radius:6px; text-align:center;">'
        '<span style="color:#ffffff; font-size:15px;">Your edit code:</span> '
        '<strong style="color:#D4A843; font-size:17px; letter-spacing:2px;">'
        f'{safe_code}</strong></p>'
        '<p>Personalize your Creator of the Month spotlight &mdash; add a headshot, bio, '
        'location, and choose which artworks to feature.</p>'
        f'<p><a href="{html.escape(profile_link)}" style="display:inline-block; padding:12px 24px; '
        'background:linear-gradient(135deg,#b8860b,#ffd700); color:#000; text-decoration:none; '
        'border-radius:6px; font-weight:bold;">Edit Your Spotlight</a></p>'
        '</div>'
    )

    plain_body = (
        f"Congratulations, {artist_name}!\n\n"
        "You've been selected as The Last Gallery's Creator of the Month!\n\n"
        "Your artwork is now featured in a special spotlight seen by every visitor.\n\n"
        f"Your edit code: {edit_code}\n\n"
        "Personalize your spotlight — add a headshot, bio, location, and choose which artworks to feature.\n"
        f"{profile_link}\n"
    )

    resend.api_key = api_key
    try:
        resend.Emails.send({
            "from": "The Last Gallery <noreply@thelastgallery.com>",
            "to": [email],
            "subject": "You're The Last Gallery's Creator of the Month!",
            "html": html_body,
            "text": plain_body,
        })
        print(f"[COTM] Congratulations email sent to {email}")
    except Exception as e:
        print(f"[COTM] Failed to send email to {email}: {e}")


def select():
    if not os.path.exists(DB_PATH):
        print("[COTM] Database not found, nothing to do.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    now = datetime.now(timezone.utc)
    current_month = now.strftime('%Y-%m')

    # Check if admin already selected a COTM this month (less than 25 days ago)
    cursor.execute(
        "SELECT selected_at FROM creator_of_the_month WHERE month = ?",
        (current_month,)
    )
    existing = cursor.fetchone()
    if existing:
        selected_at = datetime.fromisoformat(existing["selected_at"].replace("Z", "+00:00"))
        age_days = (now - selected_at).days
        if age_days < 25:
            print(f"[COTM] Month {current_month} already has a COTM selected {age_days} day(s) ago. Skipping.")
            conn.close()
            return
        print(f"[COTM] Existing selection is {age_days} days old (>=25). Re-selecting.")

    # Get last 5 COTM winners (for cooldown)
    cursor.execute(
        "SELECT artist_name FROM creator_of_the_month ORDER BY month DESC LIMIT ?",
        (COOLDOWN_MONTHS,)
    )
    recent_winners = {row["artist_name"].lower() for row in cursor.fetchall()}

    # Get all eligible artists: at least one unlocked artwork, not admin, opted in via artist_profiles
    cursor.execute("""
        SELECT DISTINCT a.artist_name
        FROM assets a
        JOIN artist_profiles ap ON LOWER(TRIM(a.contact1_value)) = ap.email
        WHERE a.unlocked = 1
          AND ap.cotm_opt_in = 1
          AND a.artist_name COLLATE NOCASE != ?
    """, (ADMIN_ARTIST_NAME,))
    all_eligible = [row["artist_name"] for row in cursor.fetchall()]

    # Filter out recent winners
    pool = [name for name in all_eligible if name.lower() not in recent_winners]

    # If everyone is in cooldown, allow all eligible (reset the pool)
    if not pool and all_eligible:
        print("[COTM] All eligible artists are in cooldown. Resetting pool.")
        pool = all_eligible

    if not pool:
        print("[COTM] No eligible artists found. Skipping.")
        conn.close()
        return

    # Random selection
    winner = random.choice(pool)
    print(f"[COTM] Selected: {winner} (pool size: {len(pool)})")

    # Get the artist's email from edit_codes via their assets
    cursor.execute("""
        SELECT DISTINCT LOWER(TRIM(contact1_value)) AS email
        FROM assets
        WHERE artist_name = ? AND contact1_value IS NOT NULL AND contact1_value != ''
        LIMIT 1
    """, (winner,))
    email_row = cursor.fetchone()
    if not email_row or not email_row["email"]:
        print(f"[COTM] No email found for {winner}. Skipping.")
        conn.close()
        return
    email = email_row["email"]

    # Insert or replace COTM record (profile data lives in artist_profiles)
    cursor.execute(
        "INSERT INTO creator_of_the_month (month, artist_name, email, selected_at, updated_at) "
        "VALUES (?, ?, ?, datetime('now'), datetime('now')) "
        "ON CONFLICT(month) DO UPDATE SET artist_name=excluded.artist_name, email=excluded.email, "
        "excluded_asset_ids='[]', selected_at=datetime('now'), updated_at=datetime('now')",
        (current_month, winner, email)
    )
    conn.commit()

    # Look up edit code for email
    cursor.execute("SELECT code FROM edit_codes WHERE email = ?", (email,))
    code_row = cursor.fetchone()
    edit_code = code_row["code"] if code_row else ""
    conn.close()

    if edit_code:
        send_cotm_email(email, winner, edit_code)
    else:
        print(f"[COTM] No edit code found for {email}. Email not sent.")

    print(f"[COTM] Done. {winner} is Creator of the Month for {current_month}.")


if __name__ == "__main__":
    select()
