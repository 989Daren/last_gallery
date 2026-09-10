# Codex Agent Guide

## Scope and sources of truth

This file applies to the entire repository. The Last Gallery is a live Flask gallery where artists upload work to a shuffled SVG tile wall, manage it with emailed edit codes, and can purchase upgrades and exhibits through Stripe. The backend is Python/Flask, persistent state is SQLite plus a small set of runtime files, and the frontend is modular vanilla JavaScript and CSS.

Inspect the actual code before assuming how a feature works. When implementation and current-state documentation disagree in an area relevant to the task, treat the implementation as authoritative and update only materially affected documentation. Treat the live schema and verified system configuration as authoritative for their respective areas.

Use these references for detail instead of expanding this guide into a second project encyclopedia:

- `CLAUDE.md`: project overview, key behavior, architecture, and shared conventions.
- `docs/CLAUDE_SCHEMA.md`: schema v24, migrations, relationships, tile registration, and SVG grid details.
- `docs/CLAUDE_FEATURES.md`: APIs, user flows, shuffle and upgrade rules, exhibits, COTM, landing zones, and frontend behavior.
- `docs/CLAUDE_INFRA.md`: deployed services, timers, backups, runtime paths, SSH, and Git-hook behavior.
- `CHANGELOG.md`: dated history of significant changes.

Do not treat `.claude/worktrees/*`, files under `reports/`, or older audit/report artifacts as authoritative. They may describe another checkout or an earlier implementation.

## Repository map

- `app.py` owns the Flask application, routes, API endpoints, upload/image handling, payments, email, shuffling, and startup initialization. Importing it is stateful: it runs database initialization/migrations, creates runtime directories, and may generate or seed info-tile state.
- `db.py` owns database connections, the base schema, and sequential schema migrations.
- `landing_zones.py` selects weekly landing zones and adjusts post-shuffle placement.
- `select_cotm.py`, `shuffle_tick.py`, `cleanup_expired.py`, and `backup_db.sh` are scheduled operational jobs. Read the matching timer/service configuration before changing their assumptions.
- `templates/index.html` is the main server-rendered page and connects backend state to the browser.
- `static/js/main.js` owns wall rendering, shared popup behavior, deep links, navigation, and zoom integration. Feature modules include `admin.js`, `countdown.js`, `upload_modal.js`, `unlock_modal.js`, `owner_edit.js`, `cotm.js`, `exhibit.js`, `exhibit_dashboard.js`, `success_banner.js`, and `deadline_banner.js`.
- `static/css/styles.css` contains the shared visual implementation. `static/grid_full.svg` defines tile geometry and IDs.
- `grid utilities/repair_tiles.py` reconciles SVG tiles with the database after grid changes; review its behavior and the schema guide before running it.

Search callers, routes, templates, frontend consumers, scheduled scripts, and persistence code before changing a cross-cutting behavior. API and schema details belong in the reference documents above.

## Working-tree and Git discipline

Start by checking the current branch and `git status`. Preserve unrelated and pre-existing working-tree changes. Read the relevant diff before editing, keep changes scoped, and do not overwrite another contributor's work. Do not commit, push, reset, clean, rebase, or rewrite history unless the task explicitly calls for it.

Review `git diff` and run `git diff --check` before handing work back. Report every changed file and any verification limitation. Avoid generated files, local caches, backups, and runtime data in commits.

### `CLAUDE.md` post-commit warning

The checkout-local post-commit hook has consequential behavior when a commit touches root `CLAUDE.md`. It copies `CLAUDE.md` to `~/pc/` when mounted, rewrites `CLAUDE_URL.txt`, creates a second commit, and runs `git push`. Do not commit a `CLAUDE.md` change unless that automatic follow-up commit and push are explicitly intended. Inspect the current hook before relying on this description because hooks are local operational state.

## Database changes

The current schema is version 24. `data/gallery.db` is the live SQLite source of truth, while `db.py` is the code authority for constructing and upgrading it.

For a schema change:

1. Inspect the current schema and every reader/writer affected by the change.
2. Add the next sequential migration in `db.py`; do not edit an old migration that may already have run.
3. Keep startup migration safe for existing databases and fresh initialization consistent with the final schema.
4. Update `docs/CLAUDE_SCHEMA.md` and any affected feature documentation.
5. Validate against a disposable database or backup copy when practical. Never use the production database as test data.
6. Plan rollback and backup handling before any production migration or destructive data operation.

Do not manually alter `schema_version` or live rows to make code and schema appear synchronized. Preserve foreign-key behavior, indexes, transaction boundaries, and concurrent job behavior.

## Sensitive and runtime files

Treat `.env` as sensitive production configuration. Do not read, display, copy, modify, or expose its contents unless the task explicitly requires configuration work. Even then, never commit it or reveal its values in output, commands, logs, screenshots, diffs, or documentation. Do not invent fallback values for required secrets. Apply the same care to edit codes, admin credentials, payment identifiers, email addresses, and uploaded user content.

These gitignored paths hold live or generated state and must not be confused with tracked source:

- `data/gallery.db`: production database.
- `data/backups/`: database backups.
- `data/grid_color.json`: active grid-color setting.
- `data/cotm_enabled.json`: active COTM switch; missing or invalid currently means disabled.
- `uploads/`: artwork, exhibit, and COTM uploads.

The tracked root `grid_color.json` is legacy and is not read by the current backend. Confirm code paths before changing or removing any apparently duplicate state file.

## Verification

There is currently no automated test suite or lint configuration. Choose verification that matches the files and behavior changed, and avoid checks that mutate live state.

At minimum:

- run syntax or static checks for changed source files, such as Python compilation and `node --check` for JavaScript;
- avoid importing `app.py` merely to check syntax because importing it has runtime side effects;
- perform targeted functional checks for affected routes, templates, browser flows, migrations, or scheduled scripts where practical, using disposable data or a controlled environment;
- verify related backend and frontend contracts together when changing an API;
- inspect the final diff and run `git diff --check`.

For CSS, templates, wall geometry, popup/navigation behavior, and responsive changes, test the relevant browser flow and viewport sizes when practical. For payment, email, cleanup, shuffle, COTM, or backup changes, test failure paths and idempotency without invoking real production side effects.

## Documentation and changelog

Keep documentation aligned with the final implementation. Update only the references affected by a change:

- schema, migration, table, or tile-registration changes: `docs/CLAUDE_SCHEMA.md`;
- endpoint, UI, workflow, pricing, shuffle, COTM, landing-zone, or other product behavior: `docs/CLAUDE_FEATURES.md`;
- service, timer, backup, deployment, runtime path, or tooling changes: `docs/CLAUDE_INFRA.md`;
- project-level architecture or operating conventions: `CLAUDE.md` and, when agent instructions change, this file.

Append a dated entry to `CHANGELOG.md` for significant user-visible, schema, operational, or architectural changes. Document the current state in the reference files and keep historical narration in the changelog. Verify facts from code or the live system; mark an operational fact as unverified or omit it rather than guessing.

## Production and systemd cautions

This checkout backs the deployed application. `flask.service` runs `python3 app.py` from this repository, and the application is configured with Flask debug mode. Code edits or process restarts can affect the live site, including through the development reloader. Treat deployment and restart actions as explicit operational work, check service status and logs, and coordinate changes that can affect active users.

Scheduled jobs can write concurrently with the web process:

- the hourly shuffle tick can advance an expired countdown and shuffle the wall;
- expiration cleanup runs twice daily;
- database backup runs every six hours;
- COTM selection runs monthly from a system-level timer.

User units live under `~/.config/systemd/user/`; the COTM unit is system-level under `/etc/systemd/system/`. Confirm the installed unit contents and current timer state before changing code they invoke. Do not edit, enable, disable, restart, or daemon-reload services and timers unless the task includes that production action. Consider SQLite transactions and job concurrency whenever a change touches shared state.

Back up live data before an authorized risky operation, and verify the backup artifact before proceeding. Never use application imports, repair utilities, cleanup scripts, shuffle jobs, or scheduled selectors as read-only inspection commands.
