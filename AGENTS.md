AGENTS.md

Purpose
- This file is for agentic coding agents working in this repo.
- Keep instructions practical: how to build, lint, test, and follow local code style.

Repository Layout (Monorepo)
- backend: Express + TypeScript + Prisma + Jest
- frontend: Next.js 14 + React + TypeScript + Jest + Playwright
- extension: Vite + React 19 + TypeScript
- Root uses npm workspaces for running scripts in each package.

Runtime and Tooling
- Node.js 20+ is expected (see project README).
- Use npm workspaces for scripts when possible; otherwise `cd` into the package.
- Do not edit generated files in `dist/`, `.next/`, or `coverage/`.

Commands: Build / Lint / Test
- Root dev (starts backend + frontend): `npm run dev`
- Backend dev: `npm --workspace backend run dev`
- Frontend dev: `npm --workspace frontend run dev`
- Extension dev: `npm --workspace extension run dev`

Backend (backend/)
- Build: `cd backend && npm run build`
- Lint: `cd backend && npm run lint`
- Lint fix: `cd backend && npm run lint:fix`
- Test (Jest): `cd backend && npm test`
- Test coverage: `cd backend && npm run test:coverage`
- Perf test: `cd backend && npm run test:perf`
- DB tools: `npm run db:migrate | db:push | db:seed | db:studio`

Backend single test
- Run a file: `cd backend && npm test -- src/modules/viewer/__tests__/viewer.routes.test.ts`
- Run by name: `cd backend && npx jest -t "AuthController"`

Frontend (frontend/)
- Build: `cd frontend && npm run build`
- Lint: `cd frontend && npm run lint`
- Unit tests (Jest): `cd frontend && npm test`
- E2E (Playwright): `cd frontend && npm run test:e2e`
- E2E report: `cd frontend && npm run test:e2e:report`

Frontend single test
- Jest file: `cd frontend && npm test -- src/app/__tests__/LandingPage.test.tsx`
- Jest by name: `cd frontend && npx jest -t "Landing page"`
- Playwright file: `cd frontend && npx playwright test e2e/auth.spec.ts`
- Playwright by name: `cd frontend && npx playwright test -g "dashboard"`
- Playwright project: `cd frontend && npx playwright test --project=chromium`

Extension (extension/)
- Build: `cd extension && npm run build`
- Lint: `cd extension && npm run lint`
- Preview: `cd extension && npm run preview`
- Tests: no test script defined yet.

Formatting and Style (Repo-wide)
- Use 2 spaces, LF, and final newline (see `.editorconfig`).
- Prettier: semicolons, double quotes, trailing commas (es5), print width 100 (see `.prettierrc`).
- Prefer ESLint rules in each package; do not disable rules unless required.
- Keep line length under 100 when possible; wrap long JSX props or arrays.
- Avoid non-ASCII in new files unless the file already contains it.

TypeScript Guidelines
- Backend TS is not `strict`, but `noImplicitAny` is true. Avoid `any`.
- Frontend TS is `strict`. Avoid `any` and keep types explicit for public APIs.
- Use `type` imports when importing types (e.g. `import type { Foo }`).
- Prefer `unknown` over `any` for untyped external inputs.
- Favor `as const` for literal unions and config objects.

Imports and Module Boundaries
- Frontend uses `@/` alias to `frontend/src` (tsconfig + Jest mapper).
- Backend does not define a TS path alias; use relative imports.
- Keep imports grouped: external, internal, then relative, with blank lines between groups.
- Avoid circular imports in services and modules; move shared types to `types/`.

Naming Conventions
- Backend filenames: kebab-case with role suffixes (`*.controller.ts`, `*.service.ts`,
  `*.routes.ts`, `*.schema.ts`, `*.middleware.ts`, `*.repository.ts`).
- Frontend components: PascalCase files (`DashboardHeader.tsx`).
- React hooks: `useX` naming, file names camelCase or `useX.ts`.
- Constants: UPPER_SNAKE_CASE when global or module constants.
- Test files: `*.test.ts` or `*.test.tsx` under `__tests__/`.

Backend Patterns
- Controllers should handle errors with try/catch and respond with `res.status(...).json(...)`.
- Use the shared logger utilities where available (`utils/logger.ts`).
- Validate request payloads with Zod schemas in `modules/*/*.schema.ts` and validation middleware.
- Avoid throwing raw errors from controllers; wrap and return a stable error payload.
- Use Prisma client via `db/prisma.ts`; avoid creating new Prisma instances per request.
- Keep route registration in `*.routes.ts` and export routers with clear prefixes.

Frontend Patterns
- Data access lives under `frontend/src/lib/api` and uses `httpClient`.
- Prefer SWR for data fetching in UI; keep fetch logic in `lib/api` modules.
- For UI tests, use Testing Library best practices and Playwright role-based selectors.
- For Next.js routing, place pages in `frontend/src/app` and keep shared UI in `components/`.
- Route handlers live in `app/**/route.ts`; keep them server-only (no `use client`).
- Client components must include `"use client"` when using hooks or browser APIs.
- Reuse `components/ui` primitives instead of duplicating UI patterns.

Testing Notes
- Backend tests live under `src/**/__tests__` and `src/__tests__`.
- Frontend unit tests live under `src/**/__tests__`.
- E2E tests live under `frontend/e2e` and mock API calls via Playwright route interception.
- Playwright auto-starts the dev server via `npm run dev:next` (see config).
- Prefer `getByRole` and accessible names in Playwright and Testing Library.
- Frontend Jest config maps `@/` and uses `jest.setup.ts` for RTL matchers.
- Backend Jest config uses `src/setupTests.ts` for test setup.

Local Dev Notes
- Backend default URL: `http://localhost:4000`.
- Frontend default URL: `http://localhost:3000`.
- Backend env file: `backend/.env`.
- Frontend env file: `frontend/.env.local`.
- For OAuth and EventSub, read README before changing callback URLs.

Code Organization
- Backend feature modules live in `backend/src/modules/*` with controllers, services, routes, schemas.
- Backend cron/jobs live in `backend/src/jobs` and are registered via `backend/src/jobs/index.ts`.
- Frontend feature code lives in `frontend/src/features` and shared UI in `frontend/src/components`.
- Keep API client logic in `frontend/src/lib/api` and utilities in `frontend/src/lib/utils`.

Extension Notes
- Extension uses Vite + React 19; keep code under `extension/src`.
- Build output goes to `extension/dist`; do not edit generated files there.

Security and Error Handling
- Backend uses rate limiting and auth middleware; preserve these patterns in new routes.
- Do not log secrets; use environment variables from `backend/.env` and `frontend/.env.local`.
- For API clients, surface user-friendly error messages and keep error logs in dev only.
- Avoid exposing raw stack traces in API responses.
- Use `HttpOnly` cookies for auth; avoid client-side token storage.

Docs and Stories
- Product docs live in `docs/architecture`, `docs/stories`, and `docs/qa`.
- Follow existing story templates and update related docs when behavior changes.

Cursor / Copilot Rules
- No `.cursor/rules`, `.cursorrules`, or `.github/copilot-instructions.md` found in this repo.

When in Doubt
- Search for a similar module and follow its structure, naming, and error handling.
- Keep changes focused per package; avoid cross-package churn unless required by the feature.
