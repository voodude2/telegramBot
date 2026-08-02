/**
 * Locale-aware assistant configuration.
 *
 * The assistant replies in whatever language the customer writes in, but two
 * things cannot be left to the model alone:
 *
 *  1. `policyKeywords` — terms that must trigger the policy lookup tool. Models
 *     reliably recognise "shipping" but often answer a non-English equivalent
 *     from memory instead of calling the tool, which is how a bot ends up
 *     inventing a returns policy.
 *  2. `apologyPhrases` — brand-voice phrases stripped from the reply if the
 *     model produces them despite instruction.
 *
 * These were hardcoded Georgian string literals inside the prompt builder and
 * the response filter. Adding a market meant editing engine code. Add a locale
 * here instead, and switch markets with SUPPORTED_LOCALES.
 */

const locales = {
  en: {
    name: 'English',
    policyKeywords: [
      'shipping', 'delivery', 'returns', 'refund', 'warranty', 'address', 'location',
    ],
    apologyPhrases: ['I apologize', 'I am sorry', 'Sorry about that', 'My apologies'],
    welcome:
      "Hello! 👋 I am TechStore's AI consultant. I can help you choose electronics, " +
      'compare prices, and answer any questions in your preferred language! How can I help you today?',
    errorMessage: 'Sorry, a technical error occurred. Please try again later.',
  },

  ka: {
    name: 'Georgian',
    policyKeywords: ['შიფინგი', 'მიტანა', 'ჩამოტანა', 'გარანტია', 'მისამართი', 'საერთაშორისო'],
    apologyPhrases: ['ბოდიშს გიხდით', 'ბოდიში', 'შეცდომა გაიპარა', 'უკაცრავად'],
    welcome:
      'გამარჯობა! 👋 მე ვარ TechStore-ის AI კონსულტანტი. ' +
      'შემიძლია გიპასუხოთ ქართულად ან ნებისმიერ ენაზე!',
    errorMessage: 'ბოდიში, ტექნიკური შეცდომა მოხდა. გთხოვთ, სცადოთ მოგვიანებით.',
  },
};

const DEFAULT_LOCALES = ['en', 'ka'];

function resolveEnabled(raw) {
  const requested = String(raw || '')
    .split(',')
    .map((code) => code.trim().toLowerCase())
    .filter(Boolean);

  const codes = requested.length > 0 ? requested : DEFAULT_LOCALES;
  const known = codes.filter((code) => locales[code]);

  const unknown = codes.filter((code) => !locales[code]);
  if (unknown.length > 0) {
    console.warn(`⚠️  Unknown locale(s) in SUPPORTED_LOCALES: ${unknown.join(', ')}`);
  }

  // Always keep at least one locale so the guardrails are never empty.
  return known.length > 0 ? known : DEFAULT_LOCALES;
}

/**
 * Two different concerns, deliberately separated:
 *
 *  - GUARDRAILS (`policyKeywords`, `apologyPhrases`) span every enabled locale.
 *    The agent must recognise a Georgian shipping question and must filter a
 *    Georgian apology, regardless of what language the interface is in.
 *
 *  - UI COPY (`ui.welcome`, `ui.errorMessage`) comes from ONE locale only.
 *    Canned text the product emits unprompted — the widget greeting, the bot's
 *    /start message — is part of the interface, and mixing languages there looks
 *    unfinished. The agent still detects and replies in the customer's language;
 *    it just does not open in a language nobody asked for.
 *
 * Set UI_LOCALE to change the interface language without touching which
 * languages the agent understands.
 */
function build(raw, uiLocaleRaw) {
  const enabled = resolveEnabled(raw);
  const active = enabled.map((code) => ({ code, ...locales[code] }));

  const requestedUi = String(uiLocaleRaw || '').trim().toLowerCase();
  const uiCode = locales[requestedUi] ? requestedUi : 'en';
  if (requestedUi && !locales[requestedUi]) {
    console.warn(`⚠️  Unknown UI_LOCALE "${requestedUi}", falling back to English.`);
  }
  const ui = locales[uiCode];

  return {
    enabled,
    active,
    uiCode,
    /** Interface copy — single language by design. */
    ui: { welcome: ui.welcome, errorMessage: ui.errorMessage },
    /** Every policy trigger term across enabled locales. */
    policyKeywords: active.flatMap((locale) => locale.policyKeywords),
    /** Every apology phrase across enabled locales, longest first so that
     *  multi-word phrases match before their own substrings. */
    apologyPhrases: active
      .flatMap((locale) => locale.apologyPhrases)
      .sort((a, b) => b.length - a.length),
  };
}

module.exports = { build, locales, DEFAULT_LOCALES };
