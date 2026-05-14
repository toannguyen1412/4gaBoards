# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Layout

pnpm workspace monorepo with three areas (see `pnpm-workspace.yaml`):

- `client/` — React 18 SPA built with a custom Webpack toolchain (`client/scripts/{start,build,test}.js`, ejected CRA-style). Bundles into `client/build/` and is served by the server in production.
- `server/` — Sails.js 1.x application (`app.js`) with Knex-managed PostgreSQL migrations under `server/db/`. Serves the API at `/api/*`, authentication routes at `/auth/*`, websocket events, and the built client.
- `packages/*` — Shared internal libraries (`@4gaboards/enums`, `@4gaboards/locales`, `@4gaboards/utils`) built to `dist/` via Rollup. The root `dev`/`start`/`test` scripts run `packages:build` first because both client and server import the built `dist/`. After changes inside `packages/`, rebuild with `pnpm packages:build` (or rely on `pnpm dev` which runs `--filter @4gaboards/* dev` in watch mode).

Node `^24.11` and pnpm `^11.0.9` are enforced via `engines`/`devEngines`.

## Common Commands

Run from repo root unless noted.

```bash
# Bootstrap
pnpm i
cp server/.env.sample server/.env
docker compose -f docker-compose-dev.yml up -d   # Postgres on :5432 (POSTGRES_HOST_AUTH_METHOD=trust)
pnpm server:db:init                              # one-time DB seed (creates demo/demo user)

# Dev — server + client + packages in watch mode
pnpm dev

# Build only
pnpm packages:build           # rebuild shared packages
pnpm client:build             # produce client/build/
pnpm docker:build             # build production image (Dockerfile)

# Lint
pnpm lint                     # all workspaces in parallel
pnpm client:lint              # eslint + stylelint
pnpm client:lint:styles:fix   # auto-fix SCSS
pnpm server:lint              # eslint with --max-warnings=0

# Tests
pnpm test                     # server then client (after packages:build)
pnpm server:test              # Mocha integration tests, lifts a real Sails app
pnpm client:test              # Jest in watch mode (CRA-style)
pnpm client:ci:test           # Jest single run

# Run a single test
pnpm -C server exec mocha test/lifecycle.test.js test/integration/path/to/file.test.js
pnpm -C client test -- --testPathPattern=SomeComponent

# DB migrations (knex against server/db/)
pnpm server:db:migration_make
pnpm server:db:migrate
pnpm server:db:rollback_one
```

Husky + `lint-staged` (see root `package.json`) run scoped lint on commit; do not bypass with `--no-verify`.

## Architecture

### Domain hierarchy

Projects → Boards → Lists → Cards → Tasks. Memberships and managers gate access; labels, attachments, comments, actions (activity), notifications, and subscriptions attach to cards/boards. The same shape exists on both sides: server models in `server/api/models/` and redux-orm models in `client/src/models/`.

### Server (Sails.js)

- Routes are declared explicitly in `server/config/routes.js` — there are no blueprint routes; every endpoint maps to a single-action controller file (e.g. `POST /api/lists/:listId/cards` → `server/api/controllers/cards/create.js`). When adding an endpoint, both the route entry and the action file are required.
- Controller actions follow Sails' machine pattern: an `inputs` schema, an `exits` map (each maps to a response in `server/api/responses/`), and a `fn` that delegates work to a helper in `server/api/helpers/<resource>/`. The helpers are where authorization, mutation, and realtime broadcast happen — controllers are thin.
- Cross-cutting concerns live in hooks: `server/api/hooks/current-user/` resolves the authenticated user for every request; `cron-failed-auths-cleanup/` and `cron-notifications-batching/` register node-cron jobs at lift; `metrics/` exposes Prometheus via `prom-client`.
- Auth: local + Google/GitHub/Microsoft/OIDC via Passport (`server/strategies/`, `server/config/passport.js`). Access tokens are issued by `controllers/access-tokens/`.
- Realtime: `sails-hook-sockets` (socket.io). Helpers broadcast room events after mutations; the client receives them in `client/src/api/socket.js` and dispatches sagas.
- Background work: image processing (`sharp`), board import/export (`tar`, `fast-csv`), avatar/attachment storage under `server/private/` and `server/public/`.

### Client (React + Redux + Saga + redux-orm)

State flow is strict and layered — follow it when adding features:

1. **`entry-actions/`** — user-intent action creators (e.g. `cards.create(...)`), dispatched from components. These are the *public surface* of the redux layer.
2. **`sagas/core/`** — saga watchers consume entry actions, call API services, then dispatch low-level `actions/`. Server-pushed socket events also funnel through sagas here.
3. **`actions/`** — plain redux actions consumed by reducers (handle*Create, handle*Update, handle*Delete patterns mirror REST verbs and socket events).
4. **`reducers/`** — split per resource; each reducer delegates to a redux-orm session so all entity state is normalized through `client/src/orm.js`.
5. **`models/`** — redux-orm models with relations mirror the server side; selectors in `selectors/` query them via reselect.
6. **`api/`** — thin fetch wrappers; `api/socket.js` wires socket.io events to saga channels.
7. **`components/`** + **`containers/`** — containers connect components to selectors/entry-actions. Avoid dispatching low-level `actions/` from components.

Routing uses a custom redux-router shim in `client/src/lib/redux-router/` plus `react-router` v7; navigation goes through dispatched actions, not `<Link>` for app-internal flows.

i18n uses `i18next` with locales from `@4gaboards/locales` (shared with server). The list of supported languages is in the README; add new keys in the package, not inline.

## Conventions & Gotchas

- `pnpm dev`/`start`/`test` automatically run `packages:build` first. If you bypass these and run client/server directly after editing `packages/*`, you'll see stale code — rebuild manually.
- The client Webpack config is **not** CRA — it's the ejected scripts under `client/scripts/` and `client/config/`. Don't suggest `react-scripts`. Same for Jest config: it lives inline in `client/package.json` under `"jest"`.
- Server tests **lift a real Sails app** against the dev database (see `server/test/lifecycle.test.js`). They need the dev Postgres (`docker-compose-dev.yml`) running and `NODE_ENV=test` is set automatically.
- ESLint config is flat (v9) — root `eslint.config.mjs` composes shared configs from `eslint-configs/`. Each workspace has its own `eslint.config.mjs` extending these.
- `start.sh` is the container entrypoint (runs migrations then `node app.js --prod`). `boards-backup.sh` / `boards-restore.sh` are documented in the README and operate on the running Docker stack.
- Deployment surfaces in this repo: `Dockerfile` + `docker-compose.yml` (production), `helm-chart/` (Kubernetes), `.github/workflows/deploy.yml`.

## Tech Stack Summary

React 18, Redux, Redux-Saga, Redux-ORM, react-beautiful-dnd, floating-ui, react-md-editor; Sails.js 1.5, Knex, Passport, socket.io, sharp, BullMQ-free node-cron; PostgreSQL 16. Build: pnpm + custom Webpack + Rollup (for packages). Lint: ESLint flat config, Stylelint, Prettier. Tests: Mocha+Chai (server), Jest+React Testing Library (client).
