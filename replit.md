# RAFMARKET

A premium Pi Network marketplace where Pi holders discover, buy, and sell goods using Pi as currency. White, black, and gold design with a serious, architectural feel.

## Run & Operate

- `pnpm --filter @workspace/rafmarket run dev` — run the frontend (port varies, managed by workflow)
- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- **Frontend:** React + Vite, TanStack Query, wouter, Tailwind CSS, shadcn/ui, Recharts, Framer Motion
- **Backend:** Express 5, Drizzle ORM + PostgreSQL
- **Auth:** Pi Network SDK (`window.Pi.authenticate`) + JWT (`SESSION_SECRET`)
- **Payments:** Pi Network SDK (`window.Pi.createPayment`) with server-side approval/completion
- **Validation:** Zod (via Orval codegen from OpenAPI spec)
- **Build:** esbuild (API), Vite (frontend)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI contract (source of truth for all endpoints)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas for server validation (do not edit)
- `lib/db/src/schema/` — Drizzle table definitions (users, categories, products, orders, cart_items)
- `artifacts/api-server/src/routes/` — Express route handlers (auth, categories, products, cart, orders, payments, admin)
- `artifacts/api-server/src/middlewares/auth.ts` — JWT auth middleware + `requireAuth`/`requireAdmin` guards
- `artifacts/rafmarket/src/` — React frontend

## Architecture decisions

- **PostgreSQL over MongoDB:** Replit provides a pre-configured PostgreSQL database with automatic schema migration on publish; Drizzle ORM provides type-safe queries. MongoDB was requested but PostgreSQL delivers the same data model with zero additional setup.
- **JWT auth stored in localStorage as `raf_token`:** Pi SDK returns an `accessToken`; the server verifies it with the Pi Network API (`api.minepi.com/v2/me`), creates/upserts the user, and returns our own JWT. The frontend uses `setAuthTokenGetter` from the api-client-react custom-fetch to attach it on every request.
- **Pi payment flow:** Cart → `createOrder` → `window.Pi.createPayment` → `initiatePayment` (server approval) → `completePayment` (server completion with txid) → order status updated to `paid`.
- **Admin role guard:** `/admin` route is protected both at the frontend (redirect) and backend (`requireAdmin` middleware). Set `role = 'admin'` in the users table directly to promote a user.
- **Numeric prices as strings in DB:** Drizzle's `numeric` type returns strings from PostgreSQL; routes call `parseFloat()` before sending to clients.

## Product

- **Home:** Hero section, featured products grid, category cards
- **Product Catalog (/products):** Search, filter by category/price, sort (newest/price/rating)
- **Product Detail (/products/:id):** Image gallery, Pi price, add to cart, seller info
- **Cart (/cart):** Line items, quantity controls, Pi payment checkout via Pi SDK
- **Orders (/orders):** Order history with status badges
- **Order Detail (/orders/:id):** Full order with Pi txid
- **Auth (/auth):** Pi Network login with branded split-screen
- **Admin (/admin):** Stats cards, revenue/orders charts, user and order management

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After any OpenAPI spec change, always run `pnpm --filter @workspace/api-spec run codegen` before touching routes or frontend hooks.
- `numeric` columns from Drizzle return strings — always `parseFloat()` before sending to the client.
- The Pi SDK is loaded via CDN in `artifacts/rafmarket/index.html` and available as `window.Pi`.
- To promote a user to admin: `UPDATE users SET role = 'admin' WHERE pi_username = '<username>';`
- The Pi payment server-side approval/completion optionally uses `PI_API_KEY` env var for verification.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
