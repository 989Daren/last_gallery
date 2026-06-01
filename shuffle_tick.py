"""
Weekly auto-shuffle trigger.

Runs every minute via systemd timer (tlg-shuffle-tick.timer). Checks the
countdown_schedule row; if status is active and target_time has passed,
runs the shuffle and rolls target_time forward by duration_seconds.

Uses the Flask app context so the shuffle has full access to app.logger,
the SVG tile cache, landing-zone selection, and post-shuffle email helpers.
A BEGIN IMMEDIATE transaction serializes against any other writer so the
shuffle can only fire once per cycle, even if multiple ticks overlap.
"""

import os
import sys
from datetime import datetime, timezone, timedelta

# Project root on sys.path so `from app import ...` works regardless of CWD
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE_DIR)

from app import app, _run_shuffle  # noqa: E402
from db import get_db  # noqa: E402


def _parse_iso_utc(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def tick():
    with app.app_context():
        conn = get_db()
        try:
            # Serialize against the manual /shuffle endpoint and any other
            # writer. The IMMEDIATE lock blocks concurrent writers from
            # entering this critical section.
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT status, target_time, duration_seconds "
                "FROM countdown_schedule WHERE id = 1"
            ).fetchone()
            if not row or row["status"] != "active" or not row["target_time"]:
                conn.rollback()
                return

            target = _parse_iso_utc(row["target_time"])
            now = datetime.now(timezone.utc)
            if now < target:
                conn.rollback()
                return

            # Roll target_time forward first so any other tick that wakes up
            # during the shuffle sees the new (future) target and exits.
            duration = row["duration_seconds"] or 604800
            new_target = (now + timedelta(seconds=duration)).strftime("%Y-%m-%dT%H:%M:%SZ")
            conn.execute(
                "UPDATE countdown_schedule SET target_time = ?, updated_at = datetime('now') "
                "WHERE id = 1",
                (new_target,),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

        # Run the shuffle outside the countdown lock — _run_shuffle takes its
        # own DB connection and we don't want to hold the countdown row lock
        # for the whole shuffle duration.
        app.logger.info("[SHUFFLE TICK] Countdown expired; running auto-shuffle. Next target: %s", new_target)
        _run_shuffle()
        app.logger.info("[SHUFFLE TICK] Auto-shuffle complete.")


if __name__ == "__main__":
    tick()
