# Architecture Notes

Written during the 2026-08-01 audit. Covers how the backend is laid out now, and
the storage work that was deliberately left out of that pass.

## Layout

```
backend/
├── index.js              Bootstrap: server, bot launch, graceful shutdown
├── app.js                Express assembly (exported for tests)
├── config/index.js       Env loading, validation, all tunables
├── lib/
│   ├── redisClient.js    Upstash client + safeRedis() degradation helper
│   ├── lruCache.js       Bounded cache with optional TTL
│   ├── keyedMutex.js     Per-session serialisation
│   ├── password.js       scrypt hashing, transparent bcrypt migration
│   └── sessions.js       HMAC-signed anonymous session ids
├── middleware/           auth, rateLimit, errors
├── routes/               products, auth, admin, chat
├── services/
│   ├── aiChat.js         Core engine, shared by web + Telegram
│   ├── ragService.js     In-memory vector RAG over Google Sheets
│   ├── googleSheets.js   Catalogue + sheet reader, cached and deduped
│   ├── chatHistory.js    Redis-backed history + bounded fallback
│   ├── memoryService.js  Mem0 wrapper
│   └── analytics.js      Usage counters and cost estimation
└── bot/telegram.js       Telegram handlers
```

The rule that keeps this from collapsing back into one file: **routes do not talk
to Redis, Gemini or Mem0 directly.** They validate input, call a service, and
shape a response.

## Data storage today

| Store | Holds | Durability |
|---|---|---|
| Upstash Redis | sessions, chat history (24h TTL), analytics (30d TTL), **user accounts** | cache-grade |
| Mem0 Cloud | long-term user profiles | vendor-managed |
| Google Sheets | product catalogue, FAQ/policies | source of truth |
| Process memory | RAG vectors, product cache, degraded-mode fallbacks | none |

## Known limits and the intended fixes

### 1. Redis is holding user accounts

This is the most significant remaining issue. Upstash is a cache: no relational
integrity, no transactions across keys, no query capability, and durability
guarantees you would not choose for credentials. `user:${email}` as the primary
key also means changing an email orphans the account and its reverse-lookup entry.

**Fix:** move `users` (and later `orders`) to Postgres. Keep Redis for sessions,
rate-limit counters and analytics counters — things that are genuinely disposable.

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,   -- case-insensitive, uniqueness enforced by the DB
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

The `UNIQUE` constraint replaces the application-level `SET NX` that currently
stands in for atomic account creation.

Migration path: dual-write to both stores, backfill, read from Postgres, drop the
Redis keys. `pg` is already a dependency.

### 2. Products live in Google Sheets

Sheets is an excellent admin UI and a fragile production read path — one API blip
and every AI product search returns nothing. `getProducts()` softens this with a
30-second cache, in-flight deduplication and a stale-cache fallback, but the
failure mode is still real.

**Fix:** Postgres becomes the read path; Sheets becomes an import source, synced
on a schedule or a webhook.

### 3. RAG vectors do not survive horizontal scaling

Every instance re-embeds the whole policy sheet at boot and holds its own copy in
process memory. At the current index size this is a few seconds and a few MB, so
it is fine — but it does not scale out, and a restart costs a full re-embed.

**Fix:** persist vectors in Redis or `pgvector`, keyed by a hash of the policy
text so unchanged rows are never re-embedded. Instances then load rather than
compute at boot.

Already in place: bounded-concurrency embedding, partial-failure tolerance, a
query-embedding cache, a shared readiness promise, and `POST /api/admin/rag/refresh`
for re-indexing without a redeploy.

### 4. Cost controls

Implemented: rate limits on chat and auth, a capped request body and media size,
a truncated message length, a preferred-model cache that stops the fallback chain
re-paying for a stale leading entry, query-embedding caching, and analytics TTLs
set once per day instead of on every request.

Still worth doing:
- **Verify the model names in `GEMINI_MODELS` against what your API key can
  actually reach.** If the leading entries are not available, the first request
  after each restart pays a failed round-trip per bad entry before finding a
  working model.
- **Replace the estimated pricing table** in `config/index.js` with current
  published rates, or set `GEMINI_PRICING`. The defaults are estimates and the
  dashboard is only as accurate as they are.
- Consider Gemini context caching for the system instruction, which is large and
  identical on every request.

### 5. Operational gaps

- No structured logging. `console.*` is fine at this size; adopt `pino` when you
  need to search logs by session id.
- No metrics beyond the analytics counters. `/healthz` is a liveness probe only.
- Chat history is capped at 40 turns with a 24-hour TTL. Conversations are not
  archived anywhere, so there is no transcript to audit after that window.

## Security posture

Fixed in the audit: JWT secret hard-fail, server-side session binding, admin
fail-closed, rate limiting, prompt-injection sanitisation of display names,
atomic registration, CSPRNG user ids, email normalisation, password policy,
non-blocking password hashing, explicit CORS, security headers, a JSON error
handler, and an admin gate on the cache-refresh route.

Deliberately not changed, and worth knowing about:

- **Tokens are stored in `localStorage`**, so any XSS can exfiltrate them. Moving
  to an httpOnly, SameSite=Strict cookie requires CSRF protection and a frontend
  change; it was out of scope for this pass.
- **JWTs cannot be revoked** before they expire. A Redis deny-list keyed by token
  id would fix this if you need forced logout.
- **The Telegram bot trusts `chat.id`**, which is correct for Telegram, but those
  sessions share the Mem0 namespace with web sessions.
