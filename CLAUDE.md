# grippo-admin

## Project purpose

Internal admin SPA for managing exercise examples (CRUD + translations)
and users (roles, goals, training history, weights). Used by the Grippo
team. Hits `/admin/*` endpoints on `grippo-backend`.

## Stack

- Vanilla JavaScript (ES2022, ESM, no TypeScript, no UI framework).
- Vite 5 for dev/build (`vite`, `vite build`, `vite preview`).
- Plain CSS, split into `styles/{base, components, features, utils}/`, entry point `styles/main.css`.
- No runtime dependencies in `package.json` — only Vite in `devDependencies`.

## Architecture rules

Layered, no DI container. Composition is wired by hand in `src/main.js`.

- `src/infrastructure/` — low-level services:
  - `http/ApiClient.js` — fetch + JWT + silent refresh timer + 401 recovery.
  - `http/endpoints.js` — hardcoded URLs to `https://grippo-app.com`.
  - `events/EventBus.js` + `events/events.js` — pub/sub for cross-feature communication.
  - `storage/StorageManager.js` + `storage/InMemoryStorage.js` — wrapper over localStorage.
- `src/domain/` — domain models and repositories:
  - `exercise/`: `ExerciseRepository`, `DictionaryStore` (muscle/equipment dictionaries from server), `ExerciseValidator`, `ExerciseNormalizer`.
  - `user/`: `UserEntity`, `UserDetailsEntity`, `UserRepository`.
- `src/features/` — feature modules as a Controller + Store + View triple:
  - `auth/`: `AuthService`, `LoginView`.
  - `exercises/`: `ExerciseController`, `ExerciseStore`, `ExerciseListView`, `ExerciseFormView`.
  - `users/`: `UserController`, `UserStore`, `UserListView`, `UserDetailView`, `userFormatters.js`.
- `src/shared/` — reusable UI and constants:
  - `components/`: `ConfirmDialog`, `SortMenu`, `Toast` (init-time singletons).
  - `constants/`, `utils/`.

`src/main.js` is the single initialization entry point. Wires
infrastructure → repositories → shared singletons (`ConfirmDialog.init({...})`)
→ AuthService → controllers → views. UI is declared in `index.html` (a
static ~25 KB file with tabs, login overlay, modals).

## Code style and naming

- Files — `PascalCase.js` for classes, `camelCase.js` for utilities.
- Classes — `PascalCase`. Private fields and methods — `_` prefix (`_accessToken`, `_scheduleRefresh`).
- Each folder exports via an `index.js` barrel file.
- Imports — single-quoted, with `.js` extension (ESM).
- Comments in code — in English, sections separated by `/* ── name ─ */`.
- UI strings — no i18n infrastructure, English.

## Locked architectural decisions

- Vanilla JS, no TypeScript. Not migrating.
- No UI framework (React/Vue/Svelte). Not introducing.
- No DI container. Composition is wired by hand in `main.js`.
- Controller + Store + View pattern for a feature — mandatory.
- `EventBus` for cross-feature communication, not a global state.
- `API_BASE = 'https://grippo-app.com'` hardcoded in `endpoints.js` — intentional, no env.
- JWT silent refresh — timer at `ACCESS_TOKEN_TTL_MS - 60s`, on failure does not log out (only a 401 from a protected request logs out with `force: true`).

## Performance budgets and priorities

No explicit budgets. Priorities:

- Bundle minimal — no framework, no polyfills. Don't add heavy dependencies.
- DOM updates — pinpoint via View classes, don't recreate the whole tree.

## Testing strategy

No tests, do not add without a request.

## Scope discipline

- Don't introduce TypeScript, build tooling beyond Vite, runtime dependencies.
- Don't introduce a UI framework.
- Don't change `endpoints.js` URLs — they are synced with backend endpoints.
- Don't touch `ApiClient` token logic (`silentRefresh`, `_scheduleRefresh`, 401 recovery) without a request.
- Don't change `index.html` structure without a request (static, hand-written).
- Don't introduce a router — this is a single-page admin with tabs.

## When to stop and ask

- Changes to endpoints or request/response shape — this is a backend API contract, sync with `grippo-backend`.
- Any change to auth (refresh, logout, 401 handling).
- A new feature folder in `src/features/` — discuss the structure before writing.
- Any dependency in `package.json`.

## Anti-patterns

- Global mutable objects outside `main.js` (state lives in Stores, configuration — in instances).
- DOM access from Controller or Store. View is the only layer that touches the DOM.
- Direct `fetch(...)` outside `ApiClient`.
- `localStorage` directly — only via `StorageManager`.
- Inline styles in JS. Styles — in `styles/`.
- Hardcoded dictionaries (muscles/equipment/groups) — they are pulled from the server via `DictionaryStore`.
