"""
One-time seed for the landing_zones table.

Inserts 10 curated zone definitions:
  - 2 zones per vertical band x 5 bands
  - Each zone anchored on a Medium tile
  - Anchor placement varies within each zone (avoid staged centering)
  - Reference viewport sized to fit a typical mobile's usable wall area at scale=1.0

All coordinates stored in DESIGN SPACE (rendered DOM coords at scale=1.0),
so the frontend can directly use center_x/center_y as scroll targets and
the shuffle can use tile_ids as the in-zone fill list.

Refuses to run if landing_zones already has rows. To re-seed, DELETE first.
"""

import sys, os, re, json, sqlite3
import xml.etree.ElementTree as ET

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
DB_PATH = os.path.join(BASE_DIR, "data", "gallery.db")
SVG_PATH = os.path.join(BASE_DIR, "static", "grid_full.svg")

# Reference viewport (design px). Sized to fit the usable wall area on a
# typical mobile after the fixed header (header + countdown/COTM bars) eats
# ~120-150px. 4 small tiles wide × 6 tall.
REF_W, REF_H = 340, 510

# Anchor placement within each zone: (frac_x, frac_y) — where the anchor's
# center sits inside the viewport. 0.5,0.5 = centered. Lower fy = anchor
# nearer the top of the viewport (preferred composition on mobile).
PLACEMENTS = [
    (0.35, 0.70),
    (0.65, 0.60),
    (0.40, 0.35),
    (0.50, 0.50),
    (0.30, 0.45),
    (0.70, 0.65),
    (0.55, 0.30),
    (0.35, 0.55),
    (0.65, 0.40),
    (0.50, 0.65),
]


def rect_position(rect):
    w = float(rect.get("width") or 0)
    h = float(rect.get("height") or 0)
    tr = rect.get("transform") or ""
    m = re.search(r"translate\(([-0-9.]+)[ ,]([-0-9.]+)\)", tr)
    if m:
        cx, cy = float(m.group(1)), float(m.group(2))
        return cx - w / 2, cy - h / 2, w, h
    return float(rect.get("x") or 0), float(rect.get("y") or 0), w, h


def parse_tiles():
    """Parse SVG and return tile records in DESIGN SPACE (rendered DOM coords).

    Matches the JS pipeline:
      1. Read raw SVG positions (pre-flip).
      2. Convert to design space via scale factor (small tile = 85px).
      3. Normalize so unflipped origin is (0, 0).
      4. Apply the vertical flip done by buildLayoutTiles() in main.js so
         coords match what the frontend renders.
    """
    tree = ET.parse(SVG_PATH)
    root = tree.getroot()
    ns = "{http://www.w3.org/2000/svg}"
    layer = root.find(ns + "g")

    items = []
    for child in layer:
        tag = child.tag.replace(ns, "")
        if tag == "rect":
            items.append(rect_position(child))
        elif tag == "g":
            rs = child.findall(ns + "rect")
            if not rs:
                continue
            ps = [rect_position(r) for r in rs]
            L = min(p[0] for p in ps)
            T = min(p[1] for p in ps)
            R = max(p[0] + p[2] for p in ps)
            B = max(p[1] + p[3] for p in ps)
            items.append((L, T, R - L, B - T))

    # Infer scale from small tile widths (40-90 SVG units)
    s_widths = [w for (l, t, w, h) in items if 40 <= w <= 90]
    scale = (sum(s_widths) / len(s_widths)) / 85.0  # SVG units per design px

    ml = min(l for (l, t, w, h) in items)
    mt = min(t for (l, t, w, h) in items)
    Mr = max(l + w for (l, t, w, h) in items)
    Mb = max(t + h for (l, t, w, h) in items)
    WALL_W = round((Mr - ml) / scale)
    WALL_H = round((Mb - mt) / scale)

    def classify(dw):
        if 60 <= dw < 128: return "s"
        if 128 <= dw < 213: return "m"
        if 213 <= dw < 298: return "lg"
        if 298 <= dw < 425: return "xl"
        return None

    units = {"s": 1, "m": 2, "lg": 3, "xl": 4}
    prefix = {"s": "S", "m": "M", "lg": "L", "xl": "XL"}
    counters = {"s": 0, "m": 0, "lg": 0, "xl": 0}

    tiles = []
    for (l, t, w, h) in items:
        sz = classify(w / scale)
        if sz is None:
            continue
        counters[sz] += 1
        tid = prefix[sz] + str(counters[sz])

        # Design space (unflipped, top-left at origin)
        design_w = units[sz] * 85
        design_h = units[sz] * 85
        norm_l = (l - ml) / scale
        norm_t = (t - mt) / scale

        # Apply buildLayoutTiles() flip so coords match rendered DOM
        rendered_top = WALL_H - design_h - norm_t
        rendered_cx = norm_l + design_w / 2
        rendered_cy = rendered_top + design_h / 2

        tiles.append({
            "id": tid,
            "sz": sz,
            "x": norm_l,          # rendered left (px)
            "y": rendered_top,    # rendered top  (px)
            "w": design_w,
            "h": design_h,
            "cx": rendered_cx,
            "cy": rendered_cy,
        })

    return tiles, WALL_W, WALL_H


def pick_anchors(m_tiles, wall_w, wall_h):
    """Same selection as the preview: 2 per band (L/R), middle of each side bucket."""
    bands = [[] for _ in range(5)]
    for t in m_tiles:
        bi = min(4, int(t["cy"] / wall_h * 5))  # band 0 = top
        bands[bi].append(t)

    chosen = []
    for bi, band in enumerate(bands):
        left = [t for t in band if t["cx"] / wall_w < 0.5]
        right = [t for t in band if t["cx"] / wall_w >= 0.5]
        if left and right:
            pl = sorted(left, key=lambda t: t["cx"])[len(left) // 2]
            pr = sorted(right, key=lambda t: t["cx"])[len(right) // 2]
        elif left:
            ls = sorted(left, key=lambda t: t["cx"])
            pl, pr = ls[0], (ls[-1] if len(ls) > 1 else None)
        else:
            rs = sorted(right, key=lambda t: t["cx"])
            pl, pr = rs[0], (rs[-1] if len(rs) > 1 else None)
        if pl: chosen.append((bi, "L", pl))
        if pr: chosen.append((bi, "R", pr))
    return chosen


def compute_zone(anchor, placement, wall_w, wall_h, tiles):
    """Compute zone center + tile list given an anchor and placement offset."""
    fx, fy = placement
    # Viewport top-left so anchor center sits at (fx, fy) of viewport
    vl = anchor["cx"] - fx * REF_W
    vt = anchor["cy"] - fy * REF_H
    # Clip to wall bounds so the reference rect stays on the wall
    vl = max(0, min(wall_w - REF_W, vl))
    vt = max(0, min(wall_h - REF_H, vt))

    center_x = round(vl + REF_W / 2)
    center_y = round(vt + REF_H / 2)

    # tile_ids: any tile whose center is inside the rect
    L, T = vl, vt
    R, B = vl + REF_W, vt + REF_H
    members = [t["id"] for t in tiles
               if L <= t["cx"] <= R and T <= t["cy"] <= B]
    return center_x, center_y, members


def main():
    tiles, wall_w, wall_h = parse_tiles()
    print(f"Wall (rendered design px): {wall_w} x {wall_h}")
    print(f"Total tiles: {len(tiles)}")

    m_tiles = [t for t in tiles if t["sz"] == "m"]
    chosen = pick_anchors(m_tiles, wall_w, wall_h)
    if len(chosen) != 10:
        print(f"ERROR: expected 10 anchors, got {len(chosen)}")
        return 1

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    cur = conn.cursor()

    existing = cur.execute("SELECT COUNT(*) FROM landing_zones").fetchone()[0]
    if existing > 0:
        print(f"REFUSING TO SEED: landing_zones already has {existing} row(s).")
        print("To re-seed, run:  DELETE FROM landing_zones;  then run this again.")
        conn.close()
        return 2

    print()
    print(f"{'#':>2} {'Band':>5} {'Anchor':>6} {'Center(x,y)':>14} {'Tiles':>6}")
    print("-" * 70)

    rows = []
    for i, (bi, side, anc) in enumerate(chosen):
        cx, cy, members = compute_zone(anc, PLACEMENTS[i], wall_w, wall_h, tiles)
        name = f"B{bi+1}{side} · {anc['id']}"
        rows.append((name, anc["id"], cx, cy, REF_W, REF_H, json.dumps(members)))
        print(f"{i+1:>2} B{bi+1}{side:>3} {anc['id']:>6} ({cx:>5},{cy:>5})  {len(members):>5}")

    # Reset AUTOINCREMENT counter so IDs start at 1 (assumes empty table — we
    # refused above if non-empty).
    cur.execute("DELETE FROM sqlite_sequence WHERE name = 'landing_zones'")
    cur.executemany("""
        INSERT INTO landing_zones (name, anchor_tile_id, center_x, center_y, ref_width, ref_height, tile_ids)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, rows)
    conn.commit()
    print()
    print(f"Seeded {len(rows)} landing zones.")
    print(f"Verify: sqlite3 {DB_PATH} 'SELECT id, name, anchor_tile_id, center_x, center_y FROM landing_zones;'")
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
