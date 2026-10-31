# Cricket Player Auction

Web app for running an IPL-style player auction.

- **Players** self-register on a public page while the submission window is open (profile, career stats, optional photo).
- **Admin** controls the window (manual close and/or deadline). Registered-player data is visible to the admin **only after the window closes**.
- On auction day the admin acts as **auctioneer** in the **live room** (`/admin/live`): starts the next player in set order (Capped Batsmen, Bowlers, Wicketkeepers, All-rounders, then the four Uncapped sets), pauses, adds time, and sells or marks unsold.
- **Team owners log in** (`/team/login`) and bid in real time in the live room (`/live`). Every bid resets a countdown (default 20 s; the opening window is twice that). When it hits zero the player is sold to the highest bidder, or goes unsold.
- The live room has two tabs, **Bidding** (host, player card, bid panel, bid history, team grid, squad composition) and **Live Auction** (big-screen view with recent results). Anyone can watch without logging in.
- The earlier **manual console** (`/admin/auction`) still works as a fallback for entering a sale by hand.
- A public **Auction Board** shows sold players and team purses.

Stack: Next.js 14 (App Router) · Node.js/Express + `ws` · PostgreSQL · Docker.

## Run locally (Docker)

```bash
docker compose up --build
# web  -> http://localhost:3000
# api  -> http://localhost:4000/health
# admin login: admin / admin12345   (override with ADMIN_PASSWORD / JWT_SECRET env vars)
```

## Run locally (without Docker)

```bash
# 1. Postgres running, then:
cd backend && cp .env.example .env   # edit DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD
npm install && npm run dev            # schema + admin + 10 teams are created on startup

# 2. in another terminal
cd frontend && npm install && npm run dev   # http://localhost:3000, /api is proxied to :4000
```

## How the flow works

| Phase | Who | What |
|---|---|---|
| Registration | Player | Fills `/register` (role, capped/uncapped, nationality, styles, matches, achievements). Nationality other than India is flagged **overseas**. |
| Window close | Admin | Dashboard → set deadline or **Close registration now**. Until then, `/api/admin/players*` and `/api/admin/auction/*` return 403. |
| Review | Admin | Approve / reject, adjust **base price slab** (₹20L … ₹2Cr), export CSV. Only approved players enter the auction. |
| Team setup | Admin | `/admin/teams`: colour, owner name, purse/squad limits, **Create passcode** (shown once; only a hash is stored). |
| Auction | Admin + owners | Admin: `/admin/live` → **Start next player**. Owners: `/live` → **BID**. Timer expiry or **Sell now** closes the lot. |
| Public | Anyone | `/live` to watch, `/board` for the sold list and purses. |

### Bid increments (lakh)
Below 100: +5 · 100 to 199: +10 · 200 to 499: +20 · 500 and above: +25 (`increment()` in `backend/src/live.js`).

### Rules enforced on every bid and sale (server side, in one DB transaction)
- Player must be approved and not already sold.
- A team cannot outbid itself, and a bid must match the price the owner saw (two owners clicking at the same instant: one wins, the other gets "price just changed").
- Price ≥ base price.
- Price ≤ team's remaining purse (default ₹120 Cr).
- Squad size < max squad (default 25).
- Overseas count < max overseas (default 8) for overseas players.

Teams, purse, squad and overseas limits are editable at `/admin/teams`.

### How real time works
State lives in one DB row (`auction_state`) and each change runs in a transaction that locks it. After each change the API runs `pg_notify`; every API instance `LISTEN`s and pushes a snapshot to its own WebSocket clients (`/ws`). So you can run several API instances without Redis. The browser falls back to polling `/api/live/state` every 2 s if the socket drops. Bids are plain REST calls, rate-limited per team.

## API summary

Public
- `GET  /api/public/status` · `POST /api/public/register` · `GET /api/public/board`

Auth
- `POST /api/auth/login` → JWT (12 h)

Admin (Bearer token)
- `GET/PUT /api/admin/settings` · `GET /api/admin/stats`
- `GET /api/admin/players` (filters: `role`, `capped`, `reg_status`, `auction_status`, `q`) · `GET /api/admin/players.csv`
- `POST /api/admin/players/approve-all` · `PATCH /api/admin/players/:id`
- `GET/POST /api/admin/teams` · `PUT/DELETE /api/admin/teams/:id`
- `GET /api/admin/auction/categories` · `GET /api/admin/auction/players`
- `POST /api/admin/auction/sell | unsold | undo | accelerate` · `GET /api/admin/auction/log`
- `POST /api/admin/live/start | next | pause | resume | extend | finalize | cancel` · `POST /api/admin/teams/:id/passcode`

Team owner
- `POST /api/auth/team-login` · `POST /api/live/bid` · `GET /api/live/state` · `GET /api/live/photo/:id` · WebSocket `/ws`

## Data model

`players` (profile, `role`, `is_capped`, `is_overseas`, `base_price_lakh`, `reg_status`, `auction_status`, `team_id`, `sold_price_lakh`) · `teams` · `admins` · `settings` · `auction_log` (audit trail of every sale/unsold/undo). Prices are stored in **lakh** as integers.

## Security notes

- Passwords hashed with bcrypt; admin JWT signed with `JWT_SECRET` (set a long random value in production).
- Rate limits on registration and login; Helmet headers; Zod validation on all inputs; parameterised SQL only; CSV export neutralises formula injection.
- Admin token is kept in `localStorage` for simplicity. For production consider an httpOnly cookie plus CSRF protection.
- Put the app behind HTTPS (the load balancer on every cloud below does this).

## Known gaps / next steps

- Email confirmation to players and an approval email (SES / Azure Communication Services / SendGrid).
- Player photo upload (S3 / Blob Storage / Cloud Storage) and email verification.
- Live video or audio of the auctioneer (the host card is a placeholder; a streaming URL could be embedded there).
- Player queue view so the auctioneer can pick a specific player instead of "next in order" (the API already supports `live/start` by id).
- Sound effects, bid shortcuts, and purse-reserve rules (keeping enough money to fill the minimum squad).
- Automated tests (Jest + Supertest for the API; Playwright for the flow) and a CI pipeline.
- A migration tool (e.g. node-pg-migrate) once the schema starts changing; today `schema.sql` is idempotent and runs on startup.

See [docs/DEPLOY.md](docs/DEPLOY.md) for AWS, Azure and GCP deployment.
