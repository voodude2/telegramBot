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

### 1. Redis is the account store — a deliberate choice

Accounts live in Redis (`user:${email}`), and this is an accepted trade for
architectural simplicity, not an oversight. What that buys and costs:

**Mitigations in place**
- Account creation is atomic via `SET NX`, standing in for a `UNIQUE` constraint.
- Emails are normalised to one canonical form before use as a key.
- Account records carry **no TTL** (verified: `TTL -1`), unlike sessions and analytics.
- Passwords are scrypt-hashed, with legacy bcrypt records upgraded on login.
- Per-account lockout and per-IP rate limiting guard the login path.
- Sessions are revocable via `token_version:${userId}`.

**Residual risks to accept knowingly**
- **Eviction.** If the Upstash database ever has an eviction policy enabled and
  reaches its memory limit, account keys are eligible for eviction like any
  other. Keep eviction disabled on this database.
- **Backups.** There is no automated export. Enable Upstash backups, or run a
  periodic `SCAN user:* → JSON` dump, or an account loss is unrecoverable.
- **No secondary indexes.** "List all users" or "find by name" means a `SCAN`.
- **Email as the key.** Changing an email would orphan the record and its
  `userId:` reverse-lookup entry. There is no email-change feature today; add
  the rename as a two-key transaction when you build one.

**If this ever needs to change**, the migration is: dual-write to Postgres,
backfill by `SCAN`, cut reads over, drop the Redis keys. `users(id UUID PK,
email CITEXT UNIQUE, name, password_hash, created_at)` — the `UNIQUE` constraint
replaces the `SET NX`. Re-add the `pg` dependency at that point.

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

Added since: per-account login lockout (`lib/loginGuard.js`), token revocation
(`lib/tokenVersions.js` + `POST /api/auth/logout-all`), and a non-enumerating
registration response.

Deliberately not changed, and worth knowing about:

- **Tokens are stored in `localStorage`**, so any XSS can exfiltrate them. Moving
  to an httpOnly, SameSite=Strict cookie requires CSRF protection and a frontend
  change; it was out of scope for this pass. Revocation now limits the blast
  radius: a leaked token can be killed with `logout-all` instead of staying valid
  for its full 7 days.
- **Revocation is eventually consistent.** Token versions are cached in-process
  for `TOKEN_VERSION_CACHE_MS` (default 5s) to keep Redis off the hot path, so a
  revoked token can survive that long. Set it to 0 for immediate revocation.
- **No password reset flow.** There is no way for a user to recover an account.
- **The Telegram bot trusts `chat.id`**, which is correct for Telegram, but those
  sessions share the Mem0 namespace with web sessions.
