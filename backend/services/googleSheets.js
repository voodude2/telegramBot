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
    config.google.serviceAccountEmail && config.google.privateKey && config.google.spreadsheetId
  );
}

async function openDocument() {
  // Dynamic import: google-spreadsheet is ESM-only and this project is CommonJS.
  const { GoogleSpreadsheet } = await import('google-spreadsheet');
  const auth = new JWT({
    email: config.google.serviceAccountEmail,
    key: config.google.privateKey.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
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

module.exports = { getProducts, getProductById, loadSheet };
