process.env.ADMIN_API_KEY = 'products-test-key';

const request = require('supertest');
const app = require('../index');
const { validateProduct, CATEGORIES } = require('../routes/adminProducts');

const AUTH = { Authorization: 'Bearer products-test-key' };

describe('Product validation', () => {
  const valid = { name: 'Test Laptop', price: 1299.99, category: 'Laptop' };

  it('accepts a well-formed product', () => {
    const { errors, value } = validateProduct(valid);
    expect(errors).toEqual([]);
    expect(value).toMatchObject({ name: 'Test Laptop', price: 1299.99, category: 'Laptop' });
  });

  it('requires name, price and category on create', () => {
    const { errors } = validateProduct({});
    expect(errors).toHaveLength(3);
  });

  it('rejects a category the AI cannot filter to', () => {
    // The model is told these are the only valid categories, so a free-text
    // value would create a product its search can never surface.
    expect(validateProduct({ ...valid, category: 'Sneakers' }).errors[0]).toMatch(/Category must be/);
    for (const category of CATEGORIES) {
      expect(validateProduct({ ...valid, category }).errors).toEqual([]);
    }
  });

  it('rejects negative and absurd prices', () => {
    expect(validateProduct({ ...valid, price: -1 }).errors[0]).toMatch(/0 or more/);
    expect(validateProduct({ ...valid, price: 'free' }).errors[0]).toMatch(/0 or more/);
    expect(validateProduct({ ...valid, price: 99999999 }).errors[0]).toMatch(/unrealistically/);
  });

  it('rounds price to two decimals', () => {
    expect(validateProduct({ ...valid, price: 10.999 }).value.price).toBe(11);
  });

  it('rejects a non-http image URL', () => {
    // Blocks javascript: and data: URLs, which would be rendered in the storefront.
    expect(validateProduct({ ...valid, image: 'javascript:alert(1)' }).errors[0]).toMatch(/http/);
    expect(validateProduct({ ...valid, image: 'https://x.com/a.png' }).errors).toEqual([]);
    expect(validateProduct({ ...valid, image: '' }).errors).toEqual([]);
  });

  it('bounds the rating to 0-5', () => {
    expect(validateProduct({ ...valid, rating: 9 }).errors[0]).toMatch(/between 0 and 5/);
    expect(validateProduct({ ...valid, rating: 4.55 }).value.rating).toBe(4.6);
  });

  it('enforces name and description length limits', () => {
    expect(validateProduct({ ...valid, name: 'A' }).errors[0]).toMatch(/at least 2/);
    expect(validateProduct({ ...valid, name: 'x'.repeat(200) }).errors[0]).toMatch(/120/);
    expect(validateProduct({ ...valid, description: 'x'.repeat(1200) }).errors[0]).toMatch(/1000/);
  });

  it('coerces assorted truthy spellings of inStock', () => {
    for (const raw of [true, 'true', 'TRUE', 'yes', '1']) {
      expect(validateProduct({ ...valid, inStock: raw }).value.inStock).toBe(true);
    }
    for (const raw of [false, 'false', 'no', '0']) {
      expect(validateProduct({ ...valid, inStock: raw }).value.inStock).toBe(false);
    }
  });

  it('only checks supplied fields in partial mode', () => {
    expect(validateProduct({ inStock: false }, { partial: true }).errors).toEqual([]);
    expect(validateProduct({ price: -5 }, { partial: true }).errors).toHaveLength(1);
  });
});

describe('Product admin routes', () => {
  const routes = [
    ['get', '/api/admin/products'],
    ['post', '/api/admin/products'],
    ['patch', '/api/admin/products/1'],
    ['delete', '/api/admin/products/1'],
    ['get', '/api/admin/products/categories'],
  ];

  it.each(routes)('rejects %s %s without the admin key', async (method, route) => {
    expect((await request(app)[method](route)).statusCode).toBe(401);
  });

  it.each(routes)('rejects %s %s with a wrong key', async (method, route) => {
    const res = await request(app)[method](route).set('Authorization', 'Bearer nope');
    expect(res.statusCode).toBe(401);
  });

  it('exposes the category list to an authorised admin', async () => {
    const res = await request(app).get('/api/admin/products/categories').set(AUTH);
    expect(res.statusCode).toBe(200);
    expect(res.body.categories).toEqual(CATEGORIES);
  });

  it('returns 400 before attempting any write when the payload is invalid', async () => {
    const res = await request(app).post('/api/admin/products').set(AUTH).send({ name: 'x' });
    expect(res.statusCode).toBe(400);
    expect(res.body.errors.length).toBeGreaterThan(0);
  });

  it('rejects a PATCH carrying no usable fields', async () => {
    const res = await request(app).patch('/api/admin/products/1').set(AUTH).send({ bogus: 1 });
    expect(res.statusCode).toBe(400);
  });
});
