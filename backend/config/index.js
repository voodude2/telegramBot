const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

// Load environment. Prefer backend/.env (works inside the Docker image, which only
// copies the backend directory); fall back to the repo-root .env for local dev.
const localEnv = path.resolve(__dirname, '../.env');
const rootEnv = path.resolve(__dirname, '../../.env');
require('dotenv').config({ path: fs.existsSync(localEnv) ? localEnv : rootEnv });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

/** Strips accidental surrounding quotes and whitespace from an env value. */
function clean(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.replace(/^"|"$/g, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Reduces an allowlist entry to the exact form a browser sends in `Origin`:
 * lowercase scheme and host, no trailing slash, no path.
 */
function normalizeOrigin(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (trimmed === '*') return '*';

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    // Wildcards are not valid URLs, so normalise those by hand.
    if (withScheme.includes('*')) {
      return withScheme.toLowerCase().replace(/\/+$/, '');
    }
    const url = new URL(withScheme);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return withScheme.toLowerCase().replace(/\/+$/, '');
  }
}

/** Builds a matcher for one allowlist entry, supporting a leading `*.` wildcard. */
function originMatcher(pattern) {
  if (!pattern.includes('*')) {
    return (origin) => origin === pattern;
  }
  const regex = new RegExp(
    `^${pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.]+')}$`
  );
  return (origin) => regex.test(origin);
}

const fatal = [];

/**
 * Secrets that must never silently fall back to a constant. In production a
 * missing value is fatal; outside production we generate an ephemeral random
 * value so local dev and CI still boot (tokens simply do not survive a restart).
 */
function requiredSecret(name, { bytes = 48 } = {}) {
  const value = clean(process.env[name]);
  if (value) return value;
  if (isProduction) {
    fatal.push(`${name} is not set. Refusing to start with an insecure default.`);
    return null;
  }
  const ephemeral = crypto.randomBytes(bytes).toString('hex');
  console.warn(
    `⚠️  ${name} is not set. Generated an ephemeral value for ${NODE_ENV}. ` +
    `Set ${name} before deploying — tokens will not survive a restart.`
  );
  return ephemeral;
}

const JWT_SECRET = requiredSecret('JWT_SECRET');

// Anonymous chat sessions are signed with a key derived from JWT_SECRET so there
// is exactly one root secret to rotate.
const SESSION_SIGNING_KEY = JWT_SECRET
  ? crypto.createHmac('sha256', JWT_SECRET).update('anon-session-v1').digest()
  : null;

const redisUrl = clean(process.env.UPSTASH_REDIS_REST_URL);
const redisToken = clean(process.env.UPSTASH_REDIS_REST_TOKEN);

const config = {
  NODE_ENV,
  isProduction,
  isTest,
  port: parseInt(process.env.PORT, 10) || 3000,

  // Comma-separated list. '*' is only tolerated outside production.
  // Entries are normalised because a browser Origin header is always a bare
  // scheme://host[:port] — a trailing slash or stray capital in the env var
  // silently fails to match, which is exactly how this broke in production.
  // A leading '*.' wildcard is supported for subdomains, e.g. https://*.onrender.com
  corsOrigins: (clean(process.env.FRONTEND_URL) || '*')
    .split(',')
    .map((o) => normalizeOrigin(o))
    .filter(Boolean),

  jwt: {
    secret: JWT_SECRET,
    expiresIn: clean(process.env.JWT_EXPIRES_IN) || '7d',
    issuer: 'techstore-api',
  },
  sessionSigningKey: SESSION_SIGNING_KEY,

  admin: {
    apiKey: clean(process.env.ADMIN_API_KEY) || null,
  },

  redis: {
    url: redisUrl,
    token: redisToken,
    enabled: Boolean(redisUrl && redisToken),
  },

  gemini: {
    apiKey: clean(process.env.GEMINI_API_KEY) || null,
    embeddingModel: clean(process.env.GEMINI_EMBEDDING_MODEL) || 'gemini-embedding-001',
    // Ordered fallback chain. The first model that answers is cached for the
    // process lifetime so a bad leading entry costs one failed call, not one per request.
    candidateModels: (clean(process.env.GEMINI_MODELS) ||
      'gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-2.5-flash-lite,gemini-2.0-flash,gemini-1.5-flash')
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean),
  },

  mem0: {
    apiKey: clean(process.env.MEM0_API_KEY) || null,
    appId: clean(process.env.MEM0_APP_ID) || 'techstore',
  },

  telegram: {
    botToken: clean(process.env.TELEGRAM_BOT_TOKEN) || null,
  },

  google: {
    serviceAccountEmail: clean(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL) || null,
    privateKey: process.env.GOOGLE_PRIVATE_KEY || null,
    spreadsheetId:
      clean(process.env.GOOGLE_SPREADSHEET_ID) || clean(process.env.SPREADSHEET_ID) || null,
    productsSheetTitle: clean(process.env.GOOGLE_PRODUCTS_SHEET) || null, // null = first tab
    policySheetTitle: clean(process.env.GOOGLE_POLICY_SHEET) || 'FAQ_Policies',
  },

  limits: {
    jsonBodyMb: parseInt(process.env.MAX_BODY_MB, 10) || 10,
    // Largest inline media payload we forward to Gemini, in bytes of base64.
    maxMediaBytes: parseInt(process.env.MAX_MEDIA_BYTES, 10) || 8 * 1024 * 1024,
    maxUserMessageChars: parseInt(process.env.MAX_MESSAGE_CHARS, 10) || 4000,
    chatHistoryTurns: parseInt(process.env.CHAT_HISTORY_TURNS, 10) || 40,
    chatHistoryTtlSeconds: 24 * 60 * 60,
    analyticsTtlSeconds: 30 * 24 * 60 * 60,
    // Bound the in-process fallback store so a Redis outage cannot OOM the box.
    inMemorySessions: parseInt(process.env.IN_MEMORY_SESSIONS, 10) || 500,
    toolRounds: 5,
  },

  rateLimits: {
    chat: { windowSeconds: 300, max: parseInt(process.env.RATE_LIMIT_CHAT, 10) || 20 },
    auth: { windowSeconds: 900, max: parseInt(process.env.RATE_LIMIT_AUTH, 10) || 10 },
    api: { windowSeconds: 900, max: parseInt(process.env.RATE_LIMIT_API, 10) || 300 },
  },

  rag: {
    similarityThreshold: parseFloat(process.env.RAG_THRESHOLD) || 0.65,
    embedConcurrency: 5,
    queryCacheSize: 200,
    // 0 disables periodic refresh; otherwise re-index the sheet on this interval.
    refreshIntervalMs: parseInt(process.env.RAG_REFRESH_MS, 10) || 0,
  },

  /**
   * Estimated Gemini pricing in USD per token, used only for the analytics cost
   * dashboard. These are ESTIMATES — verify against current published pricing
   * before treating the dashboard as authoritative. Override via GEMINI_PRICING
   * as JSON: {"model-name":{"input":0.0000001,"output":0.0000004}}
   */
  pricing: (() => {
    const defaults = {
      'gemini-1.5-flash': { input: 0.075 / 1e6, output: 0.3 / 1e6 },
      'gemini-2.0-flash': { input: 0.1 / 1e6, output: 0.4 / 1e6 },
      'gemini-2.5-flash-lite': { input: 0.1 / 1e6, output: 0.4 / 1e6 },
      default: { input: 0.1 / 1e6, output: 0.4 / 1e6 },
    };
    try {
      const override = clean(process.env.GEMINI_PRICING);
      return override ? { ...defaults, ...JSON.parse(override) } : defaults;
    } catch (err) {
      console.warn('⚠️  GEMINI_PRICING is not valid JSON, using defaults:', err.message);
      return defaults;
    }
  })(),
};

/**
 * Values copied straight out of .env.example. These are the worst kind of
 * misconfiguration: everything boots, the logs look healthy, and every browser
 * request is rejected. Warn loudly rather than fatally — a wrong CORS origin
 * only breaks the web frontend, and refusing to boot would take the Telegram
 * bot down with it.
 */
const PLACEHOLDER_PATTERN = /your-frontend|your_|example\.com|changeme|xxx+/i;

if (isProduction) {
  if (config.corsOrigins.includes('*')) {
    fatal.push('FRONTEND_URL must list explicit origins in production (wildcard CORS refused).');
  }

  const placeholders = config.corsOrigins.filter((o) => PLACEHOLDER_PATTERN.test(o));
  if (placeholders.length > 0) {
    console.warn(
      `\n${'='.repeat(72)}\n` +
        `⛔ FRONTEND_URL still contains a placeholder: ${placeholders.join(', ')}\n` +
        `   Every browser request will be blocked by CORS while the server\n` +
        `   itself looks perfectly healthy. Set FRONTEND_URL to your frontend's\n` +
        `   real origin (scheme + host, no trailing slash).\n` +
        `${'='.repeat(72)}\n`
    );
  }
  if (!config.admin.apiKey) {
    console.warn('⚠️  ADMIN_API_KEY is not set. All /api/admin routes will be denied.');
  }
}

if (fatal.length > 0) {
  console.error('❌ Invalid configuration:\n  - ' + fatal.join('\n  - '));
  throw new Error('Startup aborted due to invalid configuration.');
}

if (!config.gemini.apiKey) {
  console.warn('⚠️  GEMINI_API_KEY is not set. AI chat and RAG will be unavailable.');
}

config.isOriginAllowed = (() => {
  if (config.corsOrigins.includes('*')) return () => true;
  const matchers = config.corsOrigins.map(originMatcher);
  return (origin) => matchers.some((match) => match(origin));
})();

module.exports = config;
module.exports.normalizeOrigin = normalizeOrigin;
