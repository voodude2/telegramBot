const { JWT } = require('google-auth-library');
const config = require('../config');

/**
 * Google Sheets access for the product catalogue and the policy sheet.
 *
 * ARCHITECTURE NOTE: Sheets is a fine admin UI but a fragile production read
 * path — one API blip and every AI product search returns nothing. The stale-cache
 * fallback below softens that, but the durable fix is to make Postgres the read
 * path and Sheets an import source.
 */

const CACHE_TTL_MS = parseInt(process.env.PRODUCTS_CACHE_TTL_MS, 10) || 30 * 1000;

let cacheData = null;
let lastFetchTime = 0;
/** Shared promise for an in-flight refresh, so N concurrent misses make 1 API call. */
let inFlight = null;

function hasCredentials() {
  return Boolean(
    config.google.serviceAccountEmail && config.google.privateKey && config.google.spreadsheetId,
  );
}

const READ_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const WRITE_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

/**
 * @param {boolean} writable Requests the read/write scope. Reads keep the
 *   read-only scope so an ordinary catalogue fetch can never modify the sheet.
 *   Writing also requires the service account to have Editor access on the
 *   document itself — sharing it as Viewer will fail with a 403.
 */
async function openDocument(writable = false) {
  // Dynamic import: google-spreadsheet is ESM-only and this project is CommonJS.
  const { GoogleSpreadsheet } = await import('google-spreadsheet');
  const auth = new JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey.replace(/\\n/g, '\n'),
    scopes: [writable ? WRITE_SCOPE : READ_SCOPE],
  });

  const doc = new GoogleSpreadsheet(config.google.spreadsheetId, auth);
  await doc.loadInfo();
  return doc;
}

/**
 * Loads rows from a sheet tab by title, or the first tab when title is null.
 * @returns {Promise<Array|null>} null when the sheet is unavailable.
 */
async function loadSheet({ title = null } = {}) {
  if (!hasCredentials()) {
    console.warn('⚠️  Google Sheets credentials are not configured.');
    return null;
  }

  try {
    const doc = await openDocument();
    const sheet = title
      ? Object.values(doc.sheetsById).find((s) => s.title === title)
      : doc.sheetsByIndex[0];

    if (!sheet) {
      console.warn(`⚠️  Sheet tab "${title}" was not found.`);
      return null;
    }
    return await sheet.getRows();
  } catch (err) {
    console.error(`❌ Error reading sheet${title ? ` "${title}"` : ''}:`, err.message);
    return null;
  }
}

function parseBoolean(raw) {
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    return value === 'true' || value === '1' || value === 'yes';
  }
  return Boolean(raw);
}

function parseProductRow(row, index) {
  return {
    id: parseInt(row.get('id'), 10) || index + 1,
    name: row.get('name') || '',
    description: row.get('description') || '',
    price: parseFloat(row.get('price')) || 0,
    category: row.get('category') || 'General',
    image: row.get('image') || '',
    inStock: parseBoolean(row.get('inStock')),
    rating: parseFloat(row.get('rating')) || 5.0,
  };
}

async function fetchProducts() {
  const rows = await loadSheet({ title: config.google.productsSheetTitle });

  if (!rows) {
    // Prefer stale data over no data — an empty catalogue makes the AI claim we
    // sell nothing, which is worse than slightly out-of-date prices.
    if (cacheData) {
      console.warn('⚠️  Returning stale product cache.');
      return cacheData;
    }
    return [];
  }

  const products = rows.map(parseProductRow);
  console.log(`✅ Fetched ${products.length} products from Google Sheets.`);
  return products;
}

/**
 * Products, memoised for CACHE_TTL_MS.
 *
 * Concurrent callers on a cold cache share one fetch rather than each firing
 * their own request at the Sheets API.
 */
async function getProducts(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && cacheData && now - lastFetchTime < CACHE_TTL_MS) {
    return cacheData;
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const products = await fetchProducts();
      cacheData = products;
      lastFetchTime = Date.now();
      return products;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

async function getProductById(id) {
  const products = await getProducts();
  const numericId = parseInt(id, 10);
  if (Number.isNaN(numericId)) return undefined;
  return products.find((p) => p.id === numericId);
}

// ─── Write operations (admin only) ───────────────────────────────────────────

/** Invalidates the cache so the next read reflects a write immediately. */
function invalidateCache() {
  cacheData = null;
  lastFetchTime = 0;
}

/** Raises an operational error whose message is safe to show the admin. */
function operational(message, status) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

function requireCredentials() {
  if (!hasCredentials()) {
    throw operational(
      'Google Sheets is not configured. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY and GOOGLE_SPREADSHEET_ID.',
      503,
    );
  }
}

async function openProductSheet() {
  requireCredentials();
  const doc = await openDocument(true);
  const sheet = config.google.productsSheetTitle
    ? Object.values(doc.sheetsById).find((s) => s.title === config.google.productsSheetTitle)
    : doc.sheetsByIndex[0];

  if (!sheet) throw operational('Product sheet not found in the spreadsheet', 500);
  return sheet;
}

const PRODUCT_COLUMNS = [
  'id',
  'name',
  'description',
  'price',
  'category',
  'image',
  'inStock',
  'rating',
];

/**
 * Runs a write and translates Google's errors into something an admin can act on.
 *
 * The overwhelmingly likely failure is a 403: the spreadsheet has been shared
 * with the service account as Viewer rather than Editor, so reads work fine and
 * only writes fail. Surfacing "Internal server error" for that would send
 * someone hunting through application logs for a sharing-settings problem.
 */
async function withWriteErrors(operation) {
  try {
    return await operation();
  } catch (err) {
    const status = err?.response?.status || err?.code;
    if (status === 403) {
      throw operational(
        `Google denied write access. Share the spreadsheet with ${config.google.serviceAccountEmail} as an Editor.`,
        403,
      );
    }
    if (status === 404) {
      throw operational('Spreadsheet not found. Check GOOGLE_SPREADSHEET_ID.', 404);
    }
    if (status === 429) {
      throw operational('Google Sheets rate limit reached. Try again in a moment.', 429);
    }
    throw err;
  }
}

/** Serialises a product to the sheet's column shape. */
function toRowValues(product) {
  return {
    id: product.id,
    name: product.name,
    description: product.description ?? '',
    price: product.price,
    category: product.category,
    image: product.image ?? '',
    inStock: product.inStock ? 'TRUE' : 'FALSE',
    rating: product.rating ?? 5,
  };
}

/**
 * Creates a product. The id is allocated as max(existing) + 1 rather than
 * row count, so deleting a row can never cause a later product to reuse its id
 * and inherit its identity in carts and chat history.
 */
async function createProduct(input) {
  return withWriteErrors(async () => {
    const sheet = await openProductSheet();
    const rows = await sheet.getRows();

    const highestId = rows.reduce((max, row) => {
      const id = parseInt(row.get('id'), 10);
      return Number.isFinite(id) && id > max ? id : max;
    }, 0);

    const product = { ...input, id: highestId + 1 };
    await sheet.addRow(toRowValues(product));
    invalidateCache();
    return product;
  });
}

async function findRowById(sheet, id) {
  const rows = await sheet.getRows();
  return rows.find((row) => parseInt(row.get('id'), 10) === Number(id));
}

async function updateProduct(id, updates) {
  return withWriteErrors(async () => {
    const sheet = await openProductSheet();
    const row = await findRowById(sheet, id);
    if (!row) return null;

    const merged = toRowValues({
      id: Number(id),
      name: updates.name ?? row.get('name'),
      description: updates.description ?? row.get('description'),
      price: updates.price ?? parseFloat(row.get('price')),
      category: updates.category ?? row.get('category'),
      image: updates.image ?? row.get('image'),
      inStock: updates.inStock ?? parseBoolean(row.get('inStock')),
      rating: updates.rating ?? parseFloat(row.get('rating')),
    });

    for (const column of PRODUCT_COLUMNS) row.set(column, merged[column]);
    await row.save();
    invalidateCache();

    return parseProductRow(row, 0);
  });
}

async function deleteProduct(id) {
  return withWriteErrors(async () => {
    const sheet = await openProductSheet();
    const row = await findRowById(sheet, id);
    if (!row) return false;

    await row.delete();
    invalidateCache();
    return true;
  });
}

module.exports = {
  getProducts,
  getProductById,
  loadSheet,
  createProduct,
  updateProduct,
  deleteProduct,
  invalidateCache,
  PRODUCT_COLUMNS,
};
