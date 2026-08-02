const CATALOGUE = [
  { id: 1, name: 'Apple iPhone 15 Pro', description: 'Titanium smartphone', price: 999, category: 'Smartphone', inStock: true, rating: 4.9 },
  { id: 2, name: 'Samsung Galaxy S24 Ultra', description: 'Flagship Android device', price: 1299, category: 'Smartphone', inStock: true, rating: 4.8 },
  { id: 3, name: 'Sony WH-1000XM5', description: 'Noise cancelling headphones', price: 398, category: 'Audio', inStock: true, rating: 4.7 },
  { id: 4, name: 'MacBook Pro 14', description: 'M3 laptop for professionals', price: 1999, category: 'Laptop', inStock: false, rating: 4.8 },
  { id: 5, name: 'Pixel Buds Pro', description: 'Wireless earphones', price: 199, category: 'Audio', inStock: false, rating: 4.2 },
];

jest.mock('../services/googleSheets', () => ({
  getProducts: jest.fn(),
  getProductById: jest.fn(),
  loadSheet: jest.fn(),
}));

const { getProducts } = require('../services/googleSheets');
const { executeSearch } = require('../services/aiChat');

beforeEach(() => getProducts.mockResolvedValue(CATALOGUE));

const names = (results) => results.map((p) => p.name);

describe('Product search relevance', () => {
  it('does not return headphones for a phone query', async () => {
    // Regression: unranked substring matching matched "phone" inside
    // "headphones" and "earphones", and the prompt tells the model to present
    // every result it receives — so the agent recommended headphones to a
    // customer shopping for a phone.
    const results = await executeSearch({ searchQuery: 'phone' });
    expect(names(results)).not.toContain('Sony WH-1000XM5');
    expect(names(results)).not.toContain('Pixel Buds Pro');
  });

  it('still returns every smartphone for a phone query', async () => {
    // Precision must not come at the cost of recall: "phone" has to match the
    // Smartphone category even though it is not a whole word inside it.
    const results = await executeSearch({ searchQuery: 'phone' });
    expect(names(results)).toEqual(
      expect.arrayContaining(['Apple iPhone 15 Pro', 'Samsung Galaxy S24 Ultra'])
    );
  });

  it('ranks a name match above a category match', async () => {
    const results = await executeSearch({ searchQuery: 'iPhone' });
    expect(results[0].name).toBe('Apple iPhone 15 Pro');
  });

  it('matches across punctuation and spacing', async () => {
    expect(names(await executeSearch({ searchQuery: 'iphone15' }))).toContain('Apple iPhone 15 Pro');
  });

  it('finds audio products by category', async () => {
    const results = await executeSearch({ searchQuery: 'audio' });
    expect(names(results)).toEqual(expect.arrayContaining(['Sony WH-1000XM5', 'Pixel Buds Pro']));
  });

  it('prefers in-stock items when scores are otherwise close', async () => {
    const results = await executeSearch({ category: 'Audio' });
    expect(results[0].inStock).toBe(true);
  });

  it('returns nothing for a query that matches nothing', async () => {
    expect(await executeSearch({ searchQuery: 'lawnmower' })).toEqual([]);
  });

  it('filters by category', async () => {
    const results = await executeSearch({ category: 'Laptop' });
    expect(names(results)).toEqual(['MacBook Pro 14']);
  });

  it('caps an unfiltered browse instead of dumping the catalogue', async () => {
    const big = Array.from({ length: 100 }, (_, i) => ({
      id: i, name: `Product ${i}`, description: 'x', price: 10, category: 'Gaming', inStock: true, rating: 4,
    }));
    getProducts.mockResolvedValue(big);

    const results = await executeSearch({});
    expect(results.length).toBeLessThanOrEqual(12);
  });

  it('tolerates a product with missing fields', async () => {
    getProducts.mockResolvedValue([{ id: 9, name: 'Mystery', description: '', category: '', inStock: true }]);
    await expect(executeSearch({ searchQuery: 'mystery' })).resolves.toHaveLength(1);
  });
});
