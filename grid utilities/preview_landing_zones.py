"""
Render an SVG preview overlay of the landing zones currently in the DB.

Reads `landing_zones` directly (so what you see matches what the seed wrote).
Converts each zone's design-space rectangle to raw SVG coordinates and
injects them inside a <g transform="scale(1 -1)"> group so they align with
the wall's existing flip.

Output: grid utilities/landing_zones_preview.svg. If /home/daren/pc/ exists
(Daren's chromepull dropbox to his PC), a copy is also placed there.
"""

import os, sys, re, json, sqlite3, shutil
import xml.etree.ElementTree as ET

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(SCRIPT_DIR)
DB_PATH = os.path.join(BASE_DIR, "data", "gallery.db")
SVG_PATH = os.path.join(BASE_DIR, "static", "grid_full.svg")
OUT_PATH = os.path.join(SCRIPT_DIR, "landing_zones_preview.svg")
CHROMEPULL_OUT = "/home/daren/pc/landing_zones_preview.svg"

REF_W, REF_H = 340, 510  # design px (must match seed)

COLORS = [
    "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be",
    "#30b0c7", "#007aff", "#5856d6", "#af52de", "#ff2d92",
]


def parse_svg_geometry():
    """Return (scale, Mt_raw, ml_raw, m_tile_raw_by_id) for converting
    rendered design coords <-> raw SVG coords."""
    tree = ET.parse(SVG_PATH)
    root = tree.getroot()
    ns = "{http://www.w3.org/2000/svg}"

    def rect_position(rect):
        w = float(rect.get("width") or 0)
        h = float(rect.get("height") or 0)
        tr = rect.get("transform") or ""
        m = re.search(r"translate\(([-0-9.]+)[ ,]([-0-9.]+)\)", tr)
        if m:
            return float(m.group(1)) - w / 2, float(m.group(2)) - h / 2, w, h
        return float(rect.get("x") or 0), float(rect.get("y") or 0), w, h

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
            L = min(p[0] for p in ps); T = min(p[1] for p in ps)
            R = max(p[0] + p[2] for p in ps); B = max(p[1] + p[3] for p in ps)
            items.append((L, T, R - L, B - T))

    s_widths = [w for (l, t, w, h) in items if 40 <= w <= 90]
    scale = (sum(s_widths) / len(s_widths)) / 85.0

    ml_raw = min(l for (l, t, w, h) in items)
    Mt_raw = max(t + h for (l, t, w, h) in items)

    # Index M tiles by ID (document order, same as seed)
    def classify(dw):
        if 60 <= dw < 128: return "s"
        if 128 <= dw < 213: return "m"
        if 213 <= dw < 298: return "lg"
        if 298 <= dw < 425: return "xl"
        return None

    counters = {"s": 0, "m": 0, "lg": 0, "xl": 0}
    prefix = {"s": "S", "m": "M", "lg": "L", "xl": "XL"}
    m_tiles = {}
    for (l, t, w, h) in items:
        sz = classify(w / scale)
        if sz is None:
            continue
        counters[sz] += 1
        tid = prefix[sz] + str(counters[sz])
        if sz == "m":
            m_tiles[tid] = {"raw_l": l, "raw_t": t, "raw_w": w, "raw_h": h}
    return scale, Mt_raw, ml_raw, m_tiles


def main():
    scale, Mt_raw, ml_raw, m_tiles = parse_svg_geometry()

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    zones = list(conn.execute(
        "SELECT id, name, anchor_tile_id, center_x, center_y FROM landing_zones ORDER BY id"
    ).fetchall())
    conn.close()

    if not zones:
        print("No zones in DB. Run seed_landing_zones.py first.")
        return 1

    VP_W_RAW = REF_W * scale
    VP_H_RAW = REF_H * scale

    overlay = ['<g id="landing-zone-overlay" transform="scale(1 -1)" '
               'fill-opacity="0.20" stroke-width="5">']

    for i, z in enumerate(zones):
        color = COLORS[i % len(COLORS)]
        # Convert zone center from rendered design coords to raw SVG coords:
        #   rendered_cy = (Mt_raw - raw_cy) / scale  =>  raw_cy = Mt_raw - rendered_cy*scale
        zone_center_raw_x = z["center_x"] * scale + ml_raw
        zone_center_raw_y = Mt_raw - z["center_y"] * scale
        vl = zone_center_raw_x - VP_W_RAW / 2
        vt = zone_center_raw_y - VP_H_RAW / 2

        overlay.append(
            f'<rect x="{vl:.3f}" y="{vt:.3f}" '
            f'width="{VP_W_RAW:.3f}" height="{VP_H_RAW:.3f}" '
            f'fill="{color}" stroke="{color}" stroke-opacity="0.95" />'
        )

        anc = m_tiles.get(z["anchor_tile_id"])
        if anc:
            overlay.append(
                f'<rect x="{anc["raw_l"]:.3f}" y="{anc["raw_t"]:.3f}" '
                f'width="{anc["raw_w"]:.3f}" height="{anc["raw_h"]:.3f}" '
                f'fill="none" stroke="{color}" stroke-width="7" '
                f'stroke-dasharray="12 7" />'
            )

        # Label in visual top-left corner of zone
        label_pt = 70
        tx = vl + 14
        ty = vt + VP_H_RAW - 14  # large raw_y = visual top under flip
        overlay.append(
            f'<g transform="translate({tx:.3f} {ty:.3f}) scale(1 -1)">'
            f'<text x="0" y="0" font-size="{label_pt}" '
            f'font-family="Arial,sans-serif" font-weight="bold" '
            f'fill="{color}" stroke="white" stroke-width="3" '
            f'paint-order="stroke fill">#{i+1}</text></g>'
        )

    overlay.append("</g>")
    overlay_str = "\n".join(overlay)

    with open(SVG_PATH, "r") as f:
        svg = f.read()
    new_svg = svg.replace("</svg>", overlay_str + "\n</svg>")

    with open(OUT_PATH, "w") as f:
        f.write(new_svg)
    print(f"Wrote {OUT_PATH}")
    if os.path.isdir(os.path.dirname(CHROMEPULL_OUT)):
        shutil.copy(OUT_PATH, CHROMEPULL_OUT)
        print(f"Copied to {CHROMEPULL_OUT}")
    print()
    print("Legend (matches DB-stored zones):")
    for i, z in enumerate(zones):
        print(f"  #{i+1} {COLORS[i % len(COLORS)]}  {z['name']}  "
              f"anchor={z['anchor_tile_id']}  center=({z['center_x']},{z['center_y']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
