const { build, locales, DEFAULT_LOCALES } = require('../config/locales');
const { stripApologies } = require('../services/aiChat');

describe('Locale configuration', () => {
  it('enables English and Georgian by default', () => {
    expect(build().enabled).toEqual(DEFAULT_LOCALES);
  });

  it('honours SUPPORTED_LOCALES', () => {
    expect(build('en').enabled).toEqual(['en']);
    expect(build(' KA , en ').enabled).toEqual(['ka', 'en']);
  });

  it('ignores unknown codes instead of crashing', () => {
    expect(build('en,klingon').enabled).toEqual(['en']);
  });

  it('never ends up with an empty guardrail set', () => {
    expect(build('klingon').enabled).toEqual(DEFAULT_LOCALES);
    expect(build('').policyKeywords.length).toBeGreaterThan(0);
  });

  it('merges keywords and phrases across enabled locales', () => {
    const both = build('en,ka');
    expect(both.policyKeywords).toEqual(
      expect.arrayContaining([...locales.en.policyKeywords, ...locales.ka.policyKeywords])
    );
  });

  it('orders apology phrases longest first so a phrase beats its own substring', () => {
    const { apologyPhrases } = build('ka');
    const long = apologyPhrases.indexOf('ბოდიშს გიხდით');
    const short = apologyPhrases.indexOf('ბოდიში');
    expect(long).toBeLessThan(short);
  });

  it('builds bilingual welcome and error copy', () => {
    const both = build('en,ka');
    expect(both.welcome).toContain(locales.en.welcome);
    expect(both.welcome).toContain(locales.ka.welcome);
    expect(both.errorMessage).toContain('/');
  });
});

describe('Apology filtering', () => {
  it('strips a Georgian apology', () => {
    expect(stripApologies('ბოდიშს გიხდით, შეცდომა მოხდა. ფასია $999.')).toBe('ფასია $999.');
  });

  it('strips an English apology, which the previous Georgian-only regex missed', () => {
    expect(stripApologies('I apologize for the confusion. The price is $999.')).toBe(
      'The price is $999.'
    );
  });

  it('leaves a clean reply untouched', () => {
    const clean = 'The iPhone 15 Pro costs $999 and is in stock.';
    expect(stripApologies(clean)).toBe(clean);
  });

  it('falls back to a non-empty reply when the model only apologised', () => {
    expect(stripApologies('I am sorry.')).toBe('✅');
    expect(stripApologies('   ')).toBe('✅');
  });

  it('does not mangle an unrelated word containing a phrase fragment', () => {
    expect(stripApologies('Sorted by price, the laptops start at $899.')).toContain('$899');
  });
});
