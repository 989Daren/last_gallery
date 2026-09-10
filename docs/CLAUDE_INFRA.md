# Infrastructure & Development Environment

Verified against the Chromebook on 2026-09-10. Service state and tool versions are operational facts and can change independently of Git.

## Development Environment

- **Python**: `/usr/bin/python3`, version 3.9.2 at verification time.
- **Node.js**: v24.13.1 through nvm at `~/.nvm`. For non-interactive shells:
  ```bash
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  ```
- **Claude Code**: v2.1.200 at verification time. The executable is `~/.local/bin/claude`, linked to `~/.local/share/claude/versions/2.1.200`; it is not installed in the active nvm version's global npm packages.
- **Starting a local session**: `cd ~/last_gallery && ~/.local/bin/claude`
- **Authentication**: Run `~/.local/bin/claude auth login` from a local Chromebook terminal when interactive authentication is required.
- **Non-interactive use**: `~/.local/bin/claude -p "instruction" --dangerously-skip-permissions`

Install dependencies and run the development server from the project root:

```bash
pip install -r requirements.txt
python3 app.py
```

`app.py` binds to `0.0.0.0:5000` with `debug=True`. Importing it also runs `init_db()`, ensures runtime directories exist, generates the info-tile image if missing, and seeds missing info-tile database rows. Avoid importing `app.py` during a supposedly read-only inspection.

The repository currently has no automated test suite, lint configuration, or documented release-validation command.

## Runtime Files

The following live files are gitignored:

- `.env` — admin PIN, base URL, Resend, and Stripe configuration.
- `data/gallery.db` — SQLite source of truth.
- `data/backups/` — local database backups.
- `data/grid_color.json` — active global grid color.
- `data/cotm_enabled.json` — COTM global switch; missing/invalid means disabled.
- `uploads/` — uploaded artwork, exhibit, and COTM images.

The tracked root `grid_color.json` is not read by the current application.

## Hosting and Services

### Service Inventory

| Unit | Scope | Schedule/type | Purpose |
|------|-------|---------------|---------|
| `flask.service` | User | Long-running, restart always | Runs `/usr/bin/python3 app.py` in `/home/daren/last_gallery` |
| `thelastgallery-tunnel.service` | User | Long-running, restart always | Cloudflare Tunnel for `thelastgallery.com` |
| `sqlite-web.service` | User | Long-running, restart on failure | SQLite browser on port 8081 |
| `pc-mount.service` | User | Boot-time oneshot, remains active | SSHFS mount of the PC share at `~/pc` |
| `tlg-shuffle-tick.timer` | User | Hourly | Runs `shuffle_tick.py` when the countdown has expired |
| `cleanup-expired.timer` | User | 00:00 and 12:00 America/New_York | Removes expired unpaid artwork |
| `backup-db.timer` | User | 00:00, 06:00, 12:00, 18:00 host local time | Creates and retains SQLite backups |
| `select-cotm.timer` | System | First day of each month, 00:00 UTC | Runs COTM selection as user `daren` |

User units live in `~/.config/systemd/user/`. The COTM service and timer live in `/etc/systemd/system/`.

Useful read/status commands:

```bash
systemctl --user status flask.service
systemctl --user status thelastgallery-tunnel.service
systemctl --user status sqlite-web.service
systemctl --user status pc-mount.service
systemctl --user status tlg-shuffle-tick.timer
systemctl --user status cleanup-expired.timer
systemctl --user status backup-db.timer
systemctl status select-cotm.timer
```

Restart commands change live service state and should be used only when that operational action is intended.

### Flask and Cloudflare

- `flask.service` runs from `/home/daren/last_gallery` and invokes `/usr/bin/python3 app.py`.
- `thelastgallery-tunnel.service` runs `/usr/local/bin/cloudflared tunnel --config /home/daren/.cloudflared/thelastgallery.yml run thelastgallery`.
- The public site uses the Cloudflare tunnel and does not require inbound port forwarding.

### Scheduled Shuffle

`tlg-shuffle-tick.timer` invokes `shuffle_tick.py` hourly. The script reads `countdown_schedule`; when an active target has passed, it advances the target under `BEGIN IMMEDIATE`, commits, and then runs `_run_shuffle()` in the Flask application context. `GET /api/countdown_state` is a reader and never triggers a shuffle.

### Expiration Cleanup

`cleanup-expired.timer` invokes `cleanup_expired.py` at midnight and noon in `America/New_York`. The script deletes expired, still-locked artwork rows and upload files, clears tile assignments, and removes orphaned edit codes.

### Database Backups

`backup-db.timer` invokes `backup_db.sh` every six hours. The script:

1. uses SQLite's `.backup` command for a consistent copy,
2. stores timestamped files in `data/backups/`,
3. retains the newest 20 local backups, and
4. when `~/pc` is mounted, copies the backup to `~/pc/gallery_db_backups/` and retains the newest 20 there.

### Creator of the Month Selection

`select-cotm.timer` is a system-level timer and invokes `select_cotm.py` as `daren` on the first day of each month at 00:00 UTC. The script exits without selecting while `data/cotm_enabled.json` is disabled or absent.

## PC File Access via SSHFS

- The PC folder `C:\Users\user\chromepull` is mounted at `~/pc`.
- `pc-mount.service` mounts it from `user@100.122.187.18` with SSHFS and reconnect options.
- Files placed in the PC folder become readable under `~/pc/` while the mount is active.

## Git Hook Behavior

The checkout-local `.git/hooks/post-commit` runs only when a commit touches root `CLAUDE.md`. It then:

1. copies `CLAUDE.md` to `~/pc/CLAUDE.md` when the PC mount is available,
2. rewrites `CLAUDE_URL.txt` with a raw GitHub URL pinned to the triggering commit,
3. creates a second commit named `Update CLAUDE_URL.txt with latest CLAUDE.md commit hash`, bypassing the hook for that second commit, and
4. runs `git push`.

This means committing a `CLAUDE.md` change also pushes both commits. Do not make such a commit unless the automatic commit and remote push are intended.

## Tailscale and SSH

- Chromebook Tailscale address: `100.113.92.21`.
- SSH user: `daren`, port 22.
- The SSH server is configured to start on boot.
- A phone may use any SSH client with the same host/user and an authorized key.
- A specific LAN/mobile-test address is intentionally not documented because it was not verified and may change.

The historical PC alias/configuration may differ by client. Confirm the current local SSH configuration and identity instead of assuming a particular key path.

## Database Browser

- `sqlite-web.service` exposes `data/gallery.db` on `0.0.0.0:8081`.
- It is reachable from authorized Tailscale devices at `http://100.113.92.21:8081`.
- Avoid writes while Flask, a shuffle, cleanup, or another process is writing; read-only browsing is safe.

## GitHub

- Remote: `git@github.com:989Daren/last_gallery.git`.
- Git uses SSH authentication on the Chromebook.
