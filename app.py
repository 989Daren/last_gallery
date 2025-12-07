from flask import Flask, render_template, request, jsonify
import os
import json

app = Flask(__name__)

# ---- Grid color config ----
COLOR_CONFIG = "grid_color.json"
DEFAULT_GRID_COLOR = "#aa6655"  # set this to whatever default you want


def load_grid_color():
    """Read the current grid color from a small JSON file, or fall back to default."""
    if os.path.exists(COLOR_CONFIG):
        try:
            with open(COLOR_CONFIG, "r") as f:
                data = json.load(f)
                return data.get("color", DEFAULT_GRID_COLOR)
        except Exception:
            # If file is corrupted or unreadable, just use the default
            return DEFAULT_GRID_COLOR
    return DEFAULT_GRID_COLOR


def save_grid_color(color: str):
    """Persist the chosen grid color so all visitors see it."""
    with open(COLOR_CONFIG, "w") as f:
        json.dump({"color": color}, f)


# ---- Routes ----
@app.route("/")
def index():
    grid_color = load_grid_color()
    # Pass grid_color into the template so it can set --grid-color, etc.
    return render_template("index.html", grid_color=grid_color)


@app.route("/api/grid-color", methods=["POST"])
def set_grid_color():
    """Owner-only endpoint: update the global grid color."""
    data = request.get_json(silent=True) or {}
    color = data.get("color")

    # Very basic validation for hex colors like #abc or #aabbcc
    if not isinstance(color, str) or not color.startswith("#") or len(color) not in (4, 7):
        return jsonify({"error": "invalid color"}), 400

    save_grid_color(color)
    return jsonify({"status": "ok", "color": color})


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",  # allow network devices (your phone) to connect
        port=5000,
        debug=True
    )