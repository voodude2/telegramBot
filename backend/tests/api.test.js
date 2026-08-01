const request = require('supertest');
const app = require('../index');

describe('API Base Route', () => {
  it('should return 200 and status message on GET /', async () => {
    const res = await request(app).get('/');
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty('status', 'E-commerce Backend API is running');
  });
});
