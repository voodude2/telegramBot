const { JWT } = require('google-auth-library');

// In-memory cache setup
let cacheData = null;
let lastFetchTime = 0;
const CACHE_TTL = 15 * 1000; // 15 seconds cache

/**
 * Fetches products from Google Sheet.
 * Caches the result in memory for 15 seconds.
 */
async function getProducts(forceRefresh = false) {
  const now = Date.now();

  // Return cached data if still valid and forceRefresh is false
  if (!forceRefresh && cacheData && (now - lastFetchTime < CACHE_TTL)) {
    return cacheData;
  }

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || process.env.SPREADSHEET_ID;

  // Fallback to empty array if credentials are not fully configured
  if (!email || !privateKey || !spreadsheetId) {
    console.warn("⚠️ Google Sheets credentials not configured in .env. Returning empty products array.");
    cacheData = [];
    lastFetchTime = now;
    return cacheData;
  }

  try {
    // Dynamic import to support ES Module dependency in CommonJS Node environment
    const { GoogleSpreadsheet } = await import('google-spreadsheet');

    // Authenticate with Google Service Account
    const serviceAccountAuth = new JWT({
      email: email,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    await doc.loadInfo();

    // Use the first sheet tab
    const sheet = doc.sheetsByIndex[0];
    const rows = await sheet.getRows();

    const parsedProducts = rows.map((row, index) => {
      const rawInStock = row.get('inStock');
      const inStockBool = typeof rawInStock === 'string'
        ? (rawInStock.trim().toLowerCase() === 'true' || rawInStock.trim() === '1' || rawInStock.trim().toLowerCase() === 'yes')
        : Boolean(rawInStock);

      return {
        id: parseInt(row.get('id'), 10) || (index + 1),
        name: row.get('name') || '',
        description: row.get('description') || '',
        price: parseFloat(row.get('price')) || 0,
        category: row.get('category') || 'General',
        image: row.get('image') || '',
        inStock: inStockBool,
        rating: parseFloat(row.get('rating')) || 5.0,
      };
    });

    cacheData = parsedProducts;
    lastFetchTime = now;
    console.log(`✅ Successfully fetched ${parsedProducts.length} products from Google Sheets.`);
    return cacheData;
  } catch (error) {
    console.error("❌ Error fetching products from Google Sheets:", error.message);
    
    // If we have stale cache, return it; otherwise return empty array
    if (cacheData) {
      console.warn("⚠️ Returning stale cache data due to error.");
      return cacheData;
    }
    
    cacheData = [];
    lastFetchTime = now;
    return cacheData;
  }
}

/**
 * Gets a single product by ID
 */
async function getProductById(id) {
  const productsList = await getProducts();
  return productsList.find(p => p.id === parseInt(id, 10));
}

module.exports = {
  getProducts,
  getProductById,
};
