# Infrastructure & Development Environment

## Development Environment

- **Runtime**: Node.js v24.13.1 via nvm (`~/.nvm`). Source with:
  `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`
- **Claude Code**: v2.1.45 installed globally (`npm install -g @anthropic-ai/claude-code`)
- **Starting a session**: `cd last_gallery && claude`
- **Auth**: Run `claude auth login` from a **local terminal on the chromebook** — not via SSH from a remote machine. The auth code paste does not work over SSH.
- **Non-interactive use**: `claude -p "instruction" --dangerously-skip-permissions`

## Hosting & Remote Access

### PC File Access (SSHFS)
- PC's `C:\Users\user\chromepull` folder is mounted at `~/pc` on the Chromebook
- Auto-mounts on boot via `pc-mount.service` (user-level systemd)
- Drop files into `chromepull` on the PC → instantly readable by Claude Code at `~/pc/`
- Service file: `~/.config/systemd/user/pc-mount.service`
- Useful commands:
  ```bash
  systemctl --user status pc-mount.service
  systemctl --user restart pc-mount.service
  ```

### CLAUDE.md Auto-Sync
- A git `post-commit` hook (`.git/hooks/post-commit`) copies `CLAUDE.md` to `~/pc/` (chromepull) whenever a commit touches it
- Warns in terminal if `~/pc` is not mounted

### How the Site Runs
- **Flask app**: Managed by a user-level systemd service (`flask.service`), auto-starts on boot
- **Public domain**: Cloudflare Tunnel (`thelastgallery-tunnel.service`) exposes Flask to the internet — no port forwarding required
- Service files live in `~/.config/systemd/user/`
- Tunnel config: `~/.cloudflared/thelastgallery.yml`, tunnel name: `thelastgallery`

### Useful systemd commands
```bash
systemctl --user status flask.service
systemctl --user restart flask.service
systemctl --user status thelastgallery-tunnel.service
systemctl --user status cleanup-expired.timer
```

### Tailscale + SSH (Remote Dev Access)
- **Tailscale** installed on Chromebook (Linux, via apt), PC, and S25 Ultra phone
- **Tailscale IPs**:
  - Chromebook Linux: `100.113.92.21`
  - PC: `100.122.187.18`
  - S25 Ultra: `100.73.156.120`
- **SSH from PC**: `ssh chromebook` (config in `C:\Users\user\.ssh\config`)
- **PC SSH config entry**:
  ```
  Host chromebook
      HostName 100.113.92.21
      User daren
      IdentityFile ~/.ssh/id_ed25519
  ```
- **SSH from phone**: Termius app (S25 Ultra) → saved host `chromebook` → `100.113.92.21`, username `daren`, port `22`
- **SSH server**: Enabled to auto-start on boot (`sudo systemctl enable ssh`)

### Database Browser (sqlite-web)
- **sqlite-web** provides a browser-based GUI for live viewing and editing `gallery.db`
- Runs on the Chromebook as a user-level systemd service (`sqlite-web.service`)
- **Access from PC or any Tailscale device**: `http://100.113.92.21:8081`
- Service file: `~/.config/systemd/user/sqlite-web.service`
- **Caution**: Avoid editing while Flask is actively writing (during shuffles or uploads) to prevent SQLite locking conflicts — read-only browsing is always safe
- Useful commands:
  ```bash
  systemctl --user status sqlite-web.service
  systemctl --user restart sqlite-web.service
  ```

## GitHub
- Remote: `git@github.com:989Daren/last_gallery.git` (SSH)
- SSH key auth configured — `git push` works without credentials
