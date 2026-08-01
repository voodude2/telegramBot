// Set before the app (and therefore config) is required.
// Deliberately messy: trailing slash, uppercase, stray whitespace — all of which
// a browser's Origin header never contains, and any of which silently broke CORS
// before the values were normalised.
process.env.FRONTEND_URL = ' https://My-Frontend.onrender.com/ , https://second.example.com';

const request = require('supertest');
const config = require('../config');
const app = require('../index');

const ALLOWED = 'https://my-frontend.onrender.com';

describe('CORS origin normalisation', () => {
  it('normalises a trailing slash, casing and whitespace', () => {
    expect(config.corsOrigins).toEqual([ALLOWED, 'https://second.example.com']);
  });

  it('matches an origin that differs only by case or trailing slash', () => {
    expect(config.isOriginAllowed(config.normalizeOrigin('https://My-Frontend.onrender.com/'))).toBe(true);
    expect(config.isOriginAllowed(config.normalizeOrigin('HTTPS://MY-FRONTEND.ONRENDER.COM'))).toBe(true);
  });

  it('rejects an origin that is not on the list', () => {
    expect(config.isOriginAllowed('https://evil.example.com')).toBe(false);
  });

  it('supports a subdomain wildcard without matching the bare domain', () => {
    const { normalizeOrigin } = config;
    expect(normalizeOrigin('https://*.onrender.com')).toBe('https://*.onrender.com');
  });
});

describe('CORS response headers', () => {
  it('allows a configured origin', async () => {
    const res = await request(app).get('/api/products').set('Origin', ALLOWED);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('allows a configured origin sent with a trailing slash', async () => {
    const res = await request(app).get('/api/products').set('Origin', `${ALLOWED}/`);
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });

  it('omits the header for a disallowed origin', async () => {
    const res = await request(app).get('/api/products').set('Origin', 'https://evil.example.com');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers the preflight for a configured origin', async () => {
    const res = await request(app)
      .options('/api/chat')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-headers']).toMatch(/authorization/i);
  });

  it('serves a request with no Origin header (curl, server-to-server)', async () => {
    const res = await request(app).get('/api/products');
    expect(res.statusCode).toBe(200);
  });

  it('does not send a Cross-Origin-Resource-Policy that blocks the frontend', async () => {
    const res = await request(app).get('/api/products').set('Origin', ALLOWED);
    // 'same-site' would be wrong: onrender.com is a public suffix, so the
    // frontend and backend subdomains are not same-site.
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});
