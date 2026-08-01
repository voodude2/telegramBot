// Must be set before the app (and therefore config) is required.
process.env.ADMIN_API_KEY = 'test-admin-key-do-not-use';

const request = require('supertest');
const app = require('../index');

describe('Admin route protection', () => {
  const protectedRoutes = [
    ['get', '/api/admin/stats'],
    ['get', '/api/admin/questions'],
    ['get', '/api/admin/costs'],
    ['get', '/api/admin/timeline'],
    ['get', '/api/admin/memories'],
    ['delete', '/api/admin/memories'],
    ['post', '/api/admin/rag/refresh'],
  ];

  it.each(protectedRoutes)('rejects %s %s without a key', async (method, route) => {
    const res = await request(app)[method](route);
    expect(res.statusCode).toBe(401);
  });

  it.each(protectedRoutes)('rejects %s %s with a wrong key', async (method, route) => {
    const res = await request(app)[method](route).set('Authorization', 'Bearer wrong-key');
    expect(res.statusCode).toBe(401);
  });

  it('admits a request carrying the correct key', async () => {
    const res = await request(app)
      .get('/api/admin/health')
      .set('Authorization', 'Bearer test-admin-key-do-not-use');
    expect(res.statusCode).toBe(200);
  });

  it('gates the product cache refresh, which forces upstream Sheets traffic', async () => {
    const res = await request(app).post('/api/products/refresh');
    expect(res.statusCode).toBe(401);
  });
});
