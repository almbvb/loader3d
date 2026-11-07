# Loader3D — notes for Claude

Interactive 3D truck-loading planner (React 19 + TypeScript + three.js + zustand, Vite; UI on Tailwind CSS 4 +
shadcn/ui, React Router 7, TanStack Query) with a backend in `backend/` (Python 3.14, FastAPI, async
SQLAlchemy 2, Alembic; SQLite in dev, Postgres in prod).
Architecture, controls, API endpoints and extension points are in README.md — read it first.

## Working agreements

- The user writes in Russian: reply in Russian. All UI text is Russian; code, identifiers and comments are English.
- Units: lengths are stored in centimetres, weights in kilograms; `core/units.ts` converts for display
  (мм / см / м, кг / т). `weight` (item) and `maxLoad` (body) are optional — plans from before weights.
- Repository: https://github.com/almbvb/loader3d (private), branch `main`. Commit only when the user asks.
- UI: build from shadcn components in `src/components/ui` (style radix-nova; add more with
  `npx shadcn@latest add <name>`), lucide icons, Tailwind classes. Theme tokens live in `src/index.css`;
  `--primary` must stay equal to `COLORS.accent` in `scene/theme.ts`. One light theme (the scene is light).
- The user considers the 3D scene finished: do not change `src/scene/` or `src/scene.css` (the CSS2D
  labels) unless asked. The editor UI around it lives in `src/editor/`.

## Commands

- `npm run dev` — dev server on http://localhost:5173 (also `.claude/launch.json` → "loader3d"). Login and
  plans need the backend running too ("api" below).
- `npm test` — Vitest unit tests for `src/core`.
- `npx tsc --noEmit` — typecheck; `npm run build` — typecheck + production build.
- Admin access: `python -m app make-admin EMAIL` (`--revoke`), in Docker `docker compose exec api python -m app …`.
- Run all three before calling a change done; check scene changes in the browser.
- Backend (from `backend/`, needs uv): `uv run python -m app --reload` — migrations + API on :8000
  (`.claude/launch.json` → "api"; Vite proxies `/api` there); `uv run pytest`; `uv run ruff check .` and
  `uv run ruff format --check .`. Run them before calling a backend change done.
- Deploy: `docker compose up -d` (web: Dockerfile → Caddy, `deploy/Caddyfile`; api: `backend/Dockerfile`;
  db: Postgres). Every deploy setting is an env variable documented in `.env.example`; add new ones there,
  to `docker-compose.yml` and to README.

## Invariants (do not break)

- Cargo never floats and never intersects: every mutation of items ends with `settle()` (`core/physics.ts`);
  drag/resize previews compute heights via `supportHeight` / `restingLevels`, the user never sets Y freely.
  A dragged group keeps the level closest to the one it had (`MoveContext.preferY`), so it slides under a
  "bridge" it fits under; PgUp/PgDn and the level buttons of `SelectionView` pick another resting level.
- Fixed cargo (`CargoItem.locked`) and what it stands on (`pinnedIds()`, `core/physics.ts`) is never moved,
  turned or resized: the store refuses it, the scene does not start a tool on it (`SceneEngine.isMovable`,
  also false in the `lockCargo` view mode), autoload leaves it in place. New edit actions must check it.
  `locked` is part of the plan: `backend/app/schemas/plan_data.py` knows it.
- `src/core` is pure logic (no three.js, no React) and covered by `core.test.ts` / `autoload.test.ts`; add
  tests there for new rules.
- Autoload (`core/autoload.ts`) only moves cargo from the dock (or everything with `repackAll`) of the chosen
  vehicles, never exceeds `maxLoad`, puts lighter on heavier only with full support, never tilts cargo (keeps
  `orientation.up`), and ends with `settle()`. The safety
  thresholds (centre of gravity) live in `core/stats.ts` and are shared with the stats bar.
- World axes: X along the vehicle (towards the cab), Y up, Z across. A plan has several vehicles side by side
  along Z (lanes `LANE_SPACING`, the first on Z = 0); the rear doors of each vehicle's last body are at X = 0,
  the docks (one shared or one per vehicle, `dockMode`) are X < 0. Item `pos` is the min corner of its box;
  size comes from `itemSize()` (orientation-aware: six axis-aligned orientations, `yaw` + `up`) — never read
  `dims` as world size directly. Which vehicle an item belongs to is geometric (`ownerVehicle()`), items have no
  vehicle field. Vehicle changes move cargo with `relayout()` (`core/plan.ts`).
- Pointer routing lives in `scene/InteractionManager.ts`: press on empty space goes to OrbitControls,
  press on an item/handle is captured and becomes a `Tool`. New gestures implement `scene/tools/Tool.ts`.
- Rendering is on demand: call `engine.requestRender()` after changing anything in the scene. X-ray (see-through
  cargo, `core/xray.ts`) is recomputed in the frame only when the camera, the cargo or the settings changed;
  picking skips see-through items when something opaque is behind them.
- In dev the engine is exposed as `window.__loader3d` for debugging in the browser console.
- The scene listens for shortcuts on `window` (Del, R, arrows, Ctrl+Z). `guardSceneShortcuts` on the editor
  root stops keys inside menus/dialogs (and arrows inside tabs/selects) from reaching it — keep new
  popups Radix-based (role=menu/dialog/listbox) so the guard covers them.
- Plans come from the server: the editor loads one with `store.openPlan()` (fresh undo history) and
  `editor/planSync.ts` autosaves every change of bodies/items (PATCH with `version`; 409 → conflict
  dialog). Display settings belong to the account: `store/accountSync.ts` applies `user.settings` on login
  and PATCHes `/users/me/settings` on change; nothing of the app is kept in localStorage. A new setting goes
  into `Settings`/`DEFAULT_SETTINGS` (`useStore.ts`) and `DisplaySettingsIn` (`backend/app/schemas/auth.py`).
- Tiers exist only with `TIERS_ENABLED=true` (root `.env`, default false): the API then sends `subscription`
  and enforces limits; the frontend gets the same variable at build time as `TIERS_ENABLED`
  (`src/lib/tiers.ts`, `define` in vite.config.ts). Off — no tariff word anywhere in the UI: gate new
  tariff UI on `TIERS_ENABLED` or on `user.subscription` (null when off).
- Tiers: limits are enforced by the API (`backend/app/tiers.py`, checked in `routers/plans.py`) and mirrored
  for the UI in `src/lib/tiers.ts` (prices, texts, the pricing table) — change both. The store refuses
  vehicles/items over `limits` (`limitHit` → upgrade dialog); autoload and the step-by-step PDF are hidden
  behind `useFeature()`. There is no online payment: admins assign paid tiers.
- The access token is kept in memory by `api/client.ts`; on 401 it refreshes once via the cookie and
  retries. Never store tokens in localStorage.
- Admin API (`routers/admin.py`) needs `AdminAuth`; an admin cannot block, demote or delete themselves.
- Backend: every route is under `/api`; JSON is camelCase (`schemas/base.py` `ApiModel`); errors are
  `ApiError` with an English `code` and a Russian `message`. Plan contents are the frontend's `Plan`
  validated by `schemas/plan_data.py` — when `src/core/types.ts` or the limits in `presets.ts`/`item.ts`
  change, change it too. Old plans (`bodies` instead of `vehicles`) are converted by `parsePlan()` on the client
  and by `PlanData` on the server in the same way. A model change needs an Alembic migration that works on SQLite and Postgres
  (`test_migrations_match_the_models` checks it). Access tokens are checked against the `sessions` table
  on every request; refresh tokens rotate and live only in the httpOnly cookie.
