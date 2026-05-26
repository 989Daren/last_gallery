"""
Landing-zone selection and post-shuffle positioning.

A landing zone is the viewport-sized region the gallery loads into on first
visit each week. The week's zone is defined by two values stored in
`landing_state`:

  - anchor_tile_id: which M tile the wall is framed around
  - offset_cell:    where in the viewport that anchor sits (3x3 grid)

Anchor is a random M tile (with last-week avoidance); offset is a random
3x3 cell. Info-tile visibility and minimum displayable fill are enforced
*after* the shuffle by apply_zone_positioning.

All coordinates are in rendered design space (post-flip, scale=1.0), the
same space the frontend uses for scrollX/Y.
"""

import random
from datetime import datetime, timezone

from db import get_db


# Reference viewport (design px). Sized to fit the usable wall area on a
# typical mobile after the fixed header (header + countdown/COTM bars)
# eats ~120-150px. Mirrors the seed script's REF_W/REF_H from migration 23.
REF_W, REF_H = 340, 510

# Minimum displayable artworks required inside the chosen viewport.
MIN_ZONE_FILL = 4

# 3x3 offset grid: maps cell -> (frac_x, frac_y) — the anchor's fractional
# position inside the viewport. mc = (0.5, 0.5) centers the anchor.
# ±0.33 magnitudes give meaningful variety without pushing the anchor off-screen.
OFFSET_CELLS = {
    'ul': (0.17, 0.17), 'uc': (0.5, 0.17), 'ur': (0.83, 0.17),
    'ml': (0.17, 0.5),  'mc': (0.5, 0.5),  'mr': (0.83, 0.5),
    'll': (0.17, 0.83), 'lc': (0.5, 0.83), 'lr': (0.83, 0.83),
}


def _iso_week(dt):
    """ISO 8601 year-week string, e.g. '2026-W21'."""
    return dt.strftime("%G-W%V")


def _viewport_rect(anchor_cx, anchor_cy, offset_cell):
    """Return (L, T, R, B) of the viewport rectangle for an anchor + offset."""
    fx, fy = OFFSET_CELLS[offset_cell]
    L = anchor_cx - fx * REF_W
    T = anchor_cy - fy * REF_H
    return L, T, L + REF_W, T + REF_H


def select_landing_zone(tile_geom, now=None, conn=None):
    """Pick and persist this week's (anchor, offset) for the landing zone.

    Args:
        tile_geom: dict {tile_id: {'cx','cy','size',...}} from get_tiles_from_svg().
        now: optional UTC datetime for testing.
        conn: optional caller-managed sqlite3 connection.

    Returns:
        dict {'anchor_tile_id', 'offset_cell'} or None if no M tiles exist.
    """
    if now is None:
        now = datetime.now(timezone.utc)
    week = _iso_week(now)

    owns_conn = conn is None
    if owns_conn:
        conn = get_db()
    try:
        cur = conn.cursor()
        # Same-week re-shuffle (admin) overwrites the prior pick.
        cur.execute("DELETE FROM landing_state WHERE week = ?", (week,))

        m_tiles = [tid for tid, g in tile_geom.items() if g["size"] == "m"]
        if not m_tiles:
            if owns_conn:
                conn.commit()
            return None

        # Avoid repeating last week's anchor if alternatives exist.
        prev = cur.execute(
            "SELECT anchor_tile_id FROM landing_state ORDER BY week DESC LIMIT 1"
        ).fetchone()
        if prev:
            without_prev = [t for t in m_tiles if t != prev["anchor_tile_id"]]
            if without_prev:
                m_tiles = without_prev

        anchor = random.choice(m_tiles)
        cell = random.choice(list(OFFSET_CELLS))
        cur.execute(
            "INSERT INTO landing_state (week, anchor_tile_id, offset_cell) VALUES (?, ?, ?)",
            (week, anchor, cell),
        )
        if owns_conn:
            conn.commit()
        return {"anchor_tile_id": anchor, "offset_cell": cell}
    finally:
        if owns_conn:
            conn.close()


def _zone_tiles(state, tile_geom):
    """Set of tile_ids whose centers lie inside the viewport rect for this state."""
    anchor = tile_geom.get(state["anchor_tile_id"])
    if not anchor:
        return set()
    L, T, R, B = _viewport_rect(anchor["cx"], anchor["cy"], state["offset_cell"])
    return {
        tid for tid, g in tile_geom.items()
        if L <= g["cx"] <= R and T <= g["cy"] <= B
    }


def apply_zone_positioning(state, assignments, original_tile, tile_size_map,
                            asset_type_map, displayable_assets, tile_geom):
    """Post-shuffle swap pass to satisfy landing-zone positioning rules.

    1. Anchor swap: ensure an exhibit (fallback: any M artwork) sits at the
       anchor tile.
    2. Info swap: ensure at least one S info tile is inside the viewport
       rectangle (same-size S<->S swap from outside).
    3. Fill swap: ensure >= MIN_ZONE_FILL displayable artworks inside the
       viewport rectangle. Runs after info swap so it can compensate if the
       info swap displaced a displayable artwork.

    Tile sizes never change — only the artwork-to-tile mapping does. Every
    swap respects the no-stay-in-place rule.

    Args:
        state: dict from select_landing_zone() — needs anchor_tile_id + offset_cell.
        assignments: dict {asset_id: tile_id} from the shuffle. MUTATED.
        original_tile: dict {asset_id: tile_id} of pre-shuffle positions.
        tile_size_map: dict {tile_id: 's'|'m'|'lg'|'xl'}.
        asset_type_map: dict {asset_id: 'artwork'|'exhibit'|'info'}.
        displayable_assets: set of asset_ids that render on the wall.
        tile_geom: dict {tile_id: {'cx','cy','size',...}}.

    Returns:
        Stats dict for logging.
    """
    if not state:
        return {"anchor_swap": None, "info_swap": None, "fill_swaps": [], "final_zone_count": 0}

    anchor_tile = state["anchor_tile_id"]
    zone_tiles = _zone_tiles(state, tile_geom)
    stats = {"anchor_swap": None, "info_swap": None, "fill_swaps": [], "final_zone_count": 0}

    def tile_to_asset():
        return {tid: aid for aid, tid in assignments.items()}

    t2a = tile_to_asset()
    anchor_occupant = t2a.get(anchor_tile)
    needs_swap = (
        anchor_occupant is None
        or asset_type_map.get(anchor_occupant) != "exhibit"
    )

    if needs_swap:
        exhibit_candidates = []
        for aid, tid in assignments.items():
            if asset_type_map.get(aid) != "exhibit":
                continue
            if tile_size_map.get(tid) != "m" or tid == anchor_tile:
                continue
            if original_tile.get(aid) == anchor_tile:
                continue
            if anchor_occupant and original_tile.get(anchor_occupant) == tid:
                continue
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
            # No exhibit at any M tile; fall back to any M-sized artwork.
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

    t2a = tile_to_asset()

    # Info swap: ensure at least one S info tile sits inside the zone.
    info_in_zone = any(
        asset_type_map.get(t2a.get(t)) == "info" for t in zone_tiles
    )
    if not info_in_zone:
        # Find S info tiles currently outside the zone.
        outside_info = [
            (aid, tid) for aid, tid in assignments.items()
            if asset_type_map.get(aid) == "info"
            and tid not in zone_tiles
            and tile_size_map.get(tid) == "s"
        ]
        # Target: any S tile inside the zone (not the anchor — anchor is M).
        in_zone_s = [t for t in zone_tiles if tile_size_map.get(t) == "s"]
        random.shuffle(in_zone_s)
        for target_tile in in_zone_s:
            target_occupant = t2a.get(target_tile)
            candidates = [
                (aid, tid) for aid, tid in outside_info
                if original_tile.get(aid) != target_tile
                and (target_occupant is None
                     or original_tile.get(target_occupant) != tid)
            ]
            if not candidates:
                continue
            pick_aid, pick_tid = random.choice(candidates)
            assignments[pick_aid] = target_tile
            if target_occupant is not None:
                assignments[target_occupant] = pick_tid
            t2a = tile_to_asset()
            stats["info_swap"] = {
                "asset": pick_aid, "from": pick_tid, "to": target_tile,
                "displaced": target_occupant,
            }
            break

    def zone_count():
        return sum(
            1 for tid, aid in t2a.items()
            if tid in zone_tiles and aid in displayable_assets
        )

    def _adjacent(g1, g2):
        # Share an edge: ranges overlap on one axis, touch on the other.
        if (abs((g1['x'] + g1['w']) - g2['x']) < 0.5
                or abs((g2['x'] + g2['w']) - g1['x']) < 0.5):
            if g1['y'] < g2['y'] + g2['h'] and g2['y'] < g1['y'] + g1['h']:
                return True
        if (abs((g1['y'] + g1['h']) - g2['y']) < 0.5
                or abs((g2['y'] + g2['h']) - g1['y']) < 0.5):
            if g1['x'] < g2['x'] + g2['w'] and g2['x'] < g1['x'] + g1['w']:
                return True
        return False

    attempted_empty = set()
    while zone_count() < MIN_ZONE_FILL:
        # An info-occupied tile isn't a fill target — protect the info swap.
        empty_zone_tiles = [
            t for t in zone_tiles
            if t not in attempted_empty
            and (t not in t2a or t2a[t] not in displayable_assets)
            and asset_type_map.get(t2a.get(t)) != 'info'
        ]
        if not empty_zone_tiles:
            break
        # Prefer targets not touching any existing in-zone displayable
        # (anchor counts) to avoid clustering. Fall back if none qualify.
        in_zone_displayables = [
            t for t in zone_tiles if t2a.get(t) in displayable_assets
        ]
        non_adjacent = [
            t for t in empty_zone_tiles
            if not any(_adjacent(tile_geom[t], tile_geom[d])
                       for d in in_zone_displayables)
        ]
        target_tile = random.choice(non_adjacent or empty_zone_tiles)
        attempted_empty.add(target_tile)
        target_size = tile_size_map.get(target_tile)

        candidates = [
            (aid, tid) for aid, tid in assignments.items()
            if tid not in zone_tiles
            and tile_size_map.get(tid) == target_size
            and aid in displayable_assets
            and original_tile.get(aid) != target_tile
        ]
        if not candidates:
            continue

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
    """Return the state row for the current ISO week, or None.

    Used by the frontend on page load to know where to scroll.
    """
    week = _iso_week(datetime.now(timezone.utc))

    owns_conn = conn is None
    if owns_conn:
        conn = get_db()
    try:
        row = conn.execute(
            "SELECT anchor_tile_id, offset_cell FROM landing_state WHERE week = ?",
            (week,),
        ).fetchone()
        return dict(row) if row else None
    finally:
        if owns_conn:
            conn.close()
