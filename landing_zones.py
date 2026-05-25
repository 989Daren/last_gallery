"""
Landing zone selection for the weekly shuffle.

A landing zone is a curated viewport-sized region of the wall that the
gallery loads into on first visit. One zone is chosen per weekly shuffle;
the same zone is used for everyone visiting that week.

This module owns selection only. The shuffle (placing the chosen exhibit
into the anchor M tile and filling the zone's other tiles) lives elsewhere.
"""

import json
import random
from datetime import datetime, timezone

from db import get_db


MIN_ZONE_FILL = 4  # minimum artworks required in the chosen zone per shuffle


def _iso_week(dt):
    """ISO 8601 year-week string, e.g. '2026-W21'."""
    return dt.strftime("%G-W%V")


def _row_to_zone(row):
    """Convert a sqlite3.Row to a plain dict with tile_ids parsed."""
    z = dict(row)
    z["tile_ids"] = json.loads(z.get("tile_ids") or "[]")
    return z


def select_landing_zone(now=None, conn=None):
    """Pick and persist this week's landing zone.

    Selection rules (from TLG_LANDING_ZONES.md):
      - Only `active = 1` zones are eligible.
      - Exclude the zone with the most recent `last_used_week` (no repeats
        two weeks in a row). If excluding it would leave an empty pool
        (e.g., only one active zone exists), fall back to allowing it.
      - Random pick from the remaining pool.
      - Update the chosen zone's `last_used_week` to the current ISO week.

    Args:
        now: Optional UTC datetime for testing. Defaults to datetime.now(UTC).
        conn: Optional sqlite3 connection. If None, opens its own via get_db().

    Returns:
        The chosen zone as a dict (with `tile_ids` parsed to a list),
        or None if no active zones exist.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    current_week = _iso_week(now)

    owns_conn = conn is None
    if owns_conn:
        conn = get_db()
    cur = conn.cursor()

    try:
        # Clear any prior pick for the current week. A re-selection within the same
        # week (admin re-shuffle, etc.) overwrites the previous pick so that exactly
        # one zone ever holds the current week's marker.
        cur.execute(
            "UPDATE landing_zones SET last_used_week = NULL WHERE last_used_week = ?",
            (current_week,),
        )

        # Most recent last_used_week among active zones (NULL if none used yet).
        # After the clear above, this is necessarily a past week.
        most_recent = cur.execute(
            "SELECT MAX(last_used_week) FROM landing_zones WHERE active = 1"
        ).fetchone()[0]

        # Candidate pool: active, not the most-recently-used (if any)
        if most_recent:
            candidates = cur.execute(
                """SELECT * FROM landing_zones
                   WHERE active = 1
                     AND (last_used_week IS NULL OR last_used_week != ?)""",
                (most_recent,),
            ).fetchall()
            # Fallback: if exclusion left no options, allow all active zones
            if not candidates:
                candidates = cur.execute(
                    "SELECT * FROM landing_zones WHERE active = 1"
                ).fetchall()
        else:
            candidates = cur.execute(
                "SELECT * FROM landing_zones WHERE active = 1"
            ).fetchall()

        if not candidates:
            return None

        chosen = random.choice(candidates)

        cur.execute(
            "UPDATE landing_zones SET last_used_week = ? WHERE id = ?",
            (current_week, chosen["id"]),
        )
        if owns_conn:
            conn.commit()

        return _row_to_zone(chosen)
    finally:
        if owns_conn:
            conn.close()


def apply_zone_positioning(zone, assignments, original_tile, tile_size_map,
                            asset_type_map, displayable_assets,
                            min_zone_fill=MIN_ZONE_FILL):
    """Post-shuffle swap pass to satisfy landing-zone positioning rules.

    Operates on the size-respecting shuffle's output. Performs same-size swaps
    so that:
      1. The zone's anchor M tile holds an exhibit artwork. If no exhibit
         landed in any M tile during the shuffle, fall back to any M-sized
         artwork (random pick).
      2. At least `min_zone_fill` *displayable artwork* tiles inside the zone
         are occupied (matches the wall_state render filter — info tiles and
         assets with empty artist_name don't count). Fills by swapping in
         displayable artworks from outside-zone tiles of the same size.

    Tile *sizes* never change — only the artwork-to-tile mapping does.
    Every swap respects the no-stay-in-place rule (no artwork ends up in its
    pre-shuffle tile).

    Args:
        zone: dict from select_landing_zone() — needs anchor_tile_id, tile_ids.
        assignments: dict {asset_id: tile_id} from the shuffle. MUTATED.
        original_tile: dict {asset_id: tile_id} of pre-shuffle positions.
        tile_size_map: dict {tile_id: 's'|'m'|'lg'|'xl'}.
        asset_type_map: dict {asset_id: 'artwork'|'exhibit'|'info'}.
        displayable_assets: set of asset_ids that actually render on the wall
            (non-info AND artist_name not empty).
        min_zone_fill: minimum zone tiles to occupy.

    Returns:
        Stats dict for logging: anchor_swap, fill_swaps, final_zone_count.
    """
    if not zone:
        return {"anchor_swap": None, "fill_swaps": [], "final_zone_count": 0}

    anchor_tile = zone["anchor_tile_id"]
    zone_tiles = set(zone["tile_ids"])
    stats = {"anchor_swap": None, "fill_swaps": [], "final_zone_count": 0}

    def tile_to_asset():
        return {tid: aid for aid, tid in assignments.items()}

    # === Anchor swap: prefer exhibit at anchor, fall back to any M-sized artwork ===
    t2a = tile_to_asset()
    anchor_occupant = t2a.get(anchor_tile)
    needs_swap = (
        anchor_occupant is None
        or asset_type_map.get(anchor_occupant) != "exhibit"
    )

    if needs_swap:
        # Candidates: exhibits currently at non-anchor M tiles, respecting no-stay
        exhibit_candidates = []
        for aid, tid in assignments.items():
            if asset_type_map.get(aid) != "exhibit":
                continue
            if tile_size_map.get(tid) != "m" or tid == anchor_tile:
                continue
            if original_tile.get(aid) == anchor_tile:
                continue  # would put exhibit back in its pre-shuffle tile
            if anchor_occupant and original_tile.get(anchor_occupant) == tid:
                continue  # would push current occupant into its pre-shuffle tile
            exhibit_candidates.append((aid, tid))

        if exhibit_candidates:
            pick_aid, pick_tid = random.choice(exhibit_candidates)
            assignments[pick_aid] = anchor_tile
            if anchor_occupant is not None:
                assignments[anchor_occupant] = pick_tid
            stats["anchor_swap"] = {
                "method": "exhibit-to-anchor",
                "asset": pick_aid,
                "from": pick_tid,
                "displaced": anchor_occupant,
            }
        elif anchor_occupant is None:
            # No exhibit at any M tile, and anchor is empty: use any M-sized artwork
            m_candidates = [
                (aid, tid) for aid, tid in assignments.items()
                if tile_size_map.get(tid) == "m" and tid != anchor_tile
                and original_tile.get(aid) != anchor_tile
            ]
            if m_candidates:
                pick_aid, pick_tid = random.choice(m_candidates)
                assignments[pick_aid] = anchor_tile
                stats["anchor_swap"] = {
                    "method": "any-m-to-anchor",
                    "asset": pick_aid,
                    "from": pick_tid,
                    "displaced": None,
                }
        # else: non-exhibit M art is at anchor and no exhibit is at any M tile → fine

    # === Fill zone to min_zone_fill ===
    # "Filled" means an artwork tile (info tiles can land in the zone but
    # don't count toward the 4+ minimum, and they're never used as fill).
    t2a = tile_to_asset()

    def zone_count():
        return sum(
            1 for tid, aid in t2a.items()
            if tid in zone_tiles and aid in displayable_assets
        )

    attempted_empty = set()
    while zone_count() < min_zone_fill:
        # Treat tiles that hold non-displayable assets as effectively empty
        # — they don't render, so they don't satisfy the visible-4 rule.
        empty_zone_tiles = [
            t for t in zone_tiles
            if t not in attempted_empty
            and (t not in t2a or t2a[t] not in displayable_assets)
        ]
        if not empty_zone_tiles:
            break
        target_tile = random.choice(empty_zone_tiles)
        attempted_empty.add(target_tile)
        target_size = tile_size_map.get(target_tile)

        # Outside-zone displayable artwork at same-size tiles, respecting no-stay
        candidates = [
            (aid, tid) for aid, tid in assignments.items()
            if tid not in zone_tiles
            and tile_size_map.get(tid) == target_size
            and aid in displayable_assets
            and original_tile.get(aid) != target_tile
        ]
        if not candidates:
            continue  # try a different empty zone tile next iteration

        # If target_tile currently holds a non-displayable asset, this is a swap
        # (displaced asset moves to source tile). Reject candidates that would
        # send the displaced asset to its pre-shuffle tile.
        target_occupant = t2a.get(target_tile)
        if target_occupant is not None:
            candidates = [
                (aid, tid) for aid, tid in candidates
                if original_tile.get(target_occupant) != tid
            ]
            if not candidates:
                continue

        pick_aid, pick_tid = random.choice(candidates)
        assignments[pick_aid] = target_tile
        if target_occupant is not None:
            assignments[target_occupant] = pick_tid
        t2a = tile_to_asset()
        stats["fill_swaps"].append({
            "asset": pick_aid, "from": pick_tid, "to": target_tile,
            "displaced": target_occupant,
        })

    stats["final_zone_count"] = zone_count()
    return stats


def get_current_landing_zone(conn=None):
    """Return the zone marked as used in the current ISO week, or None.

    Used by the frontend on page load to know where to scroll.
    """
    now = datetime.now(timezone.utc)
    current_week = _iso_week(now)

    owns_conn = conn is None
    if owns_conn:
        conn = get_db()
    cur = conn.cursor()
    try:
        row = cur.execute(
            "SELECT * FROM landing_zones WHERE last_used_week = ? LIMIT 1",
            (current_week,),
        ).fetchone()
        return _row_to_zone(row) if row else None
    finally:
        if owns_conn:
            conn.close()
