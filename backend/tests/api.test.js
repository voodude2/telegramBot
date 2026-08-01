const request = require('supertest');
const app = require('../index');

describe('API base routes', () => {
  it('returns the status message on GET /', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'E-commerce Backend API is running');
  });

  it('exposes a health probe', async () => {
    const res = await request(app).get('/healthz');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  it('returns JSON (not an HTML error page) for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('sets baseline security headers', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });
});

describe('Authentication', () => {
  it('rejects a request with no bearer token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.statusCode).toBe(401);
  });

  it('rejects a forged token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(res.statusCode).toBe(401);
  });

  it('rejects a token signed with the old hardcoded fallback secret', async () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({ id: 'usr_1', email: 'a@b.co' }, 'fallback_secret_key_123');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.statusCode).toBe(401);
  });

  it('rejects a malformed email before touching storage', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'nope', password: 'longenough1', name: 'Test' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/valid email/i);
  });

  it('enforces a minimum password length', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'a@b.co', password: 'short', name: 'Test' });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/at least/i);
  });
});

describe('Chat session binding', () => {
  it('issues a signed anonymous session', async () => {
    const res = await request(app).get('/api/chat/session');
    expect(res.statusCode).toBe(200);
    expect(res.body.sessionId).toMatch(/^anon_.+\..+$/);
  });

  it('requires a message or media', async () => {
    const res = await request(app).post('/api/chat').send({ sessionId: 'anything' });
    expect(res.statusCode).toBe(400);
  });
});
