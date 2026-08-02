const express = require('express');
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} = require('../services/googleSheets');

const router = express.Router();

// Mounted behind requireAdmin. These write to the live catalogue, which is also
// the AI's product knowledge, so bad data here becomes a bad recommendation.

const CATEGORIES = [
  'Smartphone', 'Laptop', 'Audio', 'Wearable', 'Gaming', 'Tablet', 'TV', 'Drone', 'VR', 'General',
];

function parseBooleanish(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === 'true' || v === '1' || v === 'yes';
  }
  return Boolean(value);
}

/**
 * Validates a product payload.
 * @param {boolean} partial When true, only the supplied fields are checked (PATCH).
 * @returns {{ errors: string[], value: object }}
 */
function validateProduct(body, { partial = false } = {}) {
  const errors = [];
  const value = {};
  const has = (field) => body[field] !== undefined && body[field] !== null;

  if (has('name')) {
    const name = String(body.name).trim();
    if (name.length < 2) errors.push('Name must be at least 2 characters');
    else if (name.length > 120) errors.push('Name must be 120 characters or fewer');
    else value.name = name;
  } else if (!partial) {
    errors.push('Name is required');
  }

  if (has('price')) {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0) errors.push('Price must be a number of 0 or more');
    else if (price > 1_000_000) errors.push('Price is unrealistically high');
    else value.price = Math.round(price * 100) / 100;
  } else if (!partial) {
    errors.push('Price is required');
  }

  if (has('category')) {
    const category = String(body.category).trim();
    // The AI is told these are the only valid categories, so a free-text value
    // here would create products its search can never filter to.
    if (!CATEGORIES.includes(category)) {
      errors.push(`Category must be one of: ${CATEGORIES.join(', ')}`);
    } else {
      value.category = category;
    }
  } else if (!partial) {
    errors.push('Category is required');
  }

  if (has('description')) {
    const description = String(body.description).trim();
    if (description.length > 1000) errors.push('Description must be 1000 characters or fewer');
    else value.description = description;
  }

  if (has('image')) {
    const image = String(body.image).trim();
    if (image && !/^https?:\/\//i.test(image)) errors.push('Image must be an http(s) URL');
    else value.image = image;
  }

  if (has('rating')) {
    const rating = Number(body.rating);
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
      errors.push('Rating must be between 0 and 5');
    } else {
      value.rating = Math.round(rating * 10) / 10;
    }
  }

  if (has('inStock')) value.inStock = parseBooleanish(body.inStock);

  return { errors, value };
}

router.get('/categories', (_req, res) => res.json({ categories: CATEGORIES }));

router.get('/', async (_req, res, next) => {
  try {
    const products = await getProducts(true); // admins always see live data
    res.json({
      products,
      summary: {
        total: products.length,
        inStock: products.filter((p) => p.inStock).length,
        outOfStock: products.filter((p) => !p.inStock).length,
        inventoryValue: products.reduce((sum, p) => sum + (p.price || 0), 0),
        categories: products.reduce((acc, p) => {
          acc[p.category] = (acc[p.category] || 0) + 1;
          return acc;
        }, {}),
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { errors, value } = validateProduct(req.body || {});
    if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });

    const product = await createProduct({
      description: '', image: '', rating: 5, inStock: true, ...value,
    });
    res.status(201).json({ product, message: `"${product.name}" added to the catalogue` });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { errors, value } = validateProduct(req.body || {}, { partial: true });
    if (errors.length > 0) return res.status(400).json({ error: errors[0], errors });
    if (Object.keys(value).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const product = await updateProduct(req.params.id, value);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    res.json({ product, message: `"${product.name}" updated` });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await getProductById(req.params.id);
    const deleted = await deleteProduct(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Product not found' });

    res.json({ message: `"${existing?.name || `Product ${req.params.id}`}" deleted` });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.CATEGORIES = CATEGORIES;
module.exports.validateProduct = validateProduct;
