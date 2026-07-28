const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getProducts, getProductById } = require('./services/googleSheets');
const { initializeRAG, findRelevantPolicy } = require('./services/ragService');
const { Redis } = require('@upstash/redis');

// Initialize Upstash Redis with fallback to in-memory store if credentials are missing
const hasRedis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = hasRedis
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

const inMemoryHistories = new Map();

async function getChatHistory(chatId) {
  const historyKey = `chat_history:${chatId}`;
  if (redis) {
    try {
      const history = await redis.get(historyKey);
      if (history) return history;
    } catch (err) {
      console.warn("⚠️ Redis fetch failed, using fallback:", err.message);
    }
  }
  return inMemoryHistories.get(chatId) || [];
}

async function saveChatHistory(chatId, newHistory) {
  const historyKey = `chat_history:${chatId}`;
  if (newHistory.length > 40) {
    newHistory.splice(0, newHistory.length - 40);
  }
  if (redis) {
    try {
      await redis.set(historyKey, newHistory, { ex: 24 * 60 * 60 });
      return;
    } catch (err) {
      console.warn("⚠️ Redis save failed, using fallback:", err.message);
    }
  }
  inMemoryHistories.set(chatId, newHistory);
}

// Helper function to execute product search
async function executeSearch({ searchQuery, category }) {
  const products = await getProducts();
  return products.filter(p => {
    let match = true;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      match = match && (p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.category.toLowerCase().includes(q));
    }
    if (category) {
      const cat = category.toLowerCase();
      match = match && (p.category.toLowerCase().includes(cat) || cat.includes(p.category.toLowerCase()));
    }
    return match;
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Setup Express middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || '*'
}));
app.use(express.json());

// API Endpoints
app.get('/', (req, res) => {
  res.send({ status: 'E-commerce Backend API is running' });
});

app.get('/api/products', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const productsList = await getProducts(forceRefresh);
    res.json(productsList);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

app.post('/api/products/refresh', async (req, res) => {
  try {
    const productsList = await getProducts(true);
    res.json({ message: 'Cache refreshed successfully', count: productsList.length, products: productsList });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh products cache' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const product = await getProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Setup Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Core AI Chat Processing Engine (Shared by Web API and Telegram Bot)
async function processAIChat({ sessionId, userMessage }) {
  const systemInstruction = `You are a friendly and knowledgeable AI consultant for TechStore, an electronics store. Your primary base language is English, but you MUST automatically detect and respond in the EXACT SAME LANGUAGE that the user writes their message in. Use the searchProducts tool to look up real-time inventory. Use the askStorePolicy tool to answer ANY questions related to store policies, returns, shipping, FAQ, etc. Always format prices with the $ (USD) symbol. Be helpful, enthusiastic, and professional. CRITICAL INSTRUCTION: You are strictly limited to answering questions related to TechStore, electronics, gadgets, our products, and our policies. If a user asks a question completely unrelated to these topics (e.g. history, politics, general knowledge, math, etc.), you MUST politely decline to answer and remind them that you are only here to assist with TechStore inquiries.`;

  const searchProductsTool = {
    functionDeclarations: [
      {
        name: "searchProducts",
        description: "Search the real-time product inventory for products matching a specific query or category.",
        parameters: {
          type: "OBJECT",
          properties: {
            searchQuery: {
              type: "STRING",
              description: "The search query to match against product names or descriptions."
            },
            category: {
              type: "STRING",
              description: "The product category to filter by (e.g., Electronics, Accessories)."
            }
          }
        }
      },
      {
        name: "askStorePolicy",
        description: "Look up store policies, return policies, shipping information, FAQs, or any general store rules.",
        parameters: {
          type: "OBJECT",
          properties: {
            query: {
              type: "STRING",
              description: "The specific policy topic or question the user is asking about (e.g. 'return policy', 'shipping times')."
            }
          },
          required: ["query"]
        }
      }
    ]
  };

  let history = await getChatHistory(sessionId);

  const candidateModels = ['gemini-3.5-flash-lite'];
  let responseText = '';
  let lastError = null;

  for (const modelName of candidateModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemInstruction,
        tools: [searchProductsTool],
      });

      const clonedHistory = JSON.parse(JSON.stringify(history));
      let chat = model.startChat({ history: clonedHistory });
      
      let result = await chat.sendMessage(userMessage);
      
      let searchResults = null;
      let policyResult = null;
      const functionCalls = result.response.functionCalls ? result.response.functionCalls() : [];
      
      if (functionCalls && functionCalls.length > 0) {
         const call = functionCalls[0];
         
         if (call.name === 'searchProducts') {
            console.log(`🤖 [${sessionId}] Model called searchProducts with args:`, call.args);
            searchResults = await executeSearch(call.args);
            
            result = await chat.sendMessage([{
              functionResponse: {
                name: 'searchProducts',
                response: { products: searchResults }
              }
            }]);
         } 
         else if (call.name === 'askStorePolicy') {
            console.log(`🤖 [${sessionId}] Model called askStorePolicy with args:`, call.args);
            policyResult = await findRelevantPolicy(call.args.query);
            
            result = await chat.sendMessage([{
              functionResponse: {
                name: 'askStorePolicy',
                response: { policy: policyResult }
              }
            }]);
         }
      }

      try {
        responseText = result.response.text();
      } catch (e) {
        responseText = '';
      }

      if (!responseText || responseText.trim() === '') {
        if (searchResults && searchResults.length > 0) {
          responseText = "Here are the matching items found in our live inventory:\n\n" + 
            searchResults.map(p => `• **${p.name}** - $${p.price} (${p.inStock ? 'In Stock' : 'Out of Stock'})\n  _${p.description}_`).join('\n\n');
        } else if (searchResults && searchResults.length === 0) {
          responseText = "We currently don't have exact matches in stock for that item. Feel free to ask about our smartphones, laptops, audio gear, or accessories!";
        }
      }
      
      const newHistory = await chat.getHistory();
      await saveChatHistory(sessionId, newHistory);
      
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Model ${modelName} failed for session ${sessionId}. Error details:`, err);
    }
  }

  if (lastError && !responseText) {
    console.error(`❌ [processAIChat] All candidate models failed. Final error:`, lastError);
    throw lastError;
  }

  return responseText;
}

// Web API endpoint for Website AI Chat Widget
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const cleanSessionId = sessionId || 'web_default_session';
    const reply = await processAIChat({ sessionId: cleanSessionId, userMessage: message });
    res.json({ reply });
  } catch (err) {
    console.error('❌ [API /api/chat] Error handling chat request:', err);
    res.status(500).json({ error: 'Failed to process AI chat request' });
  }
});

// Setup Telegram Bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

bot.start((ctx) => {
  ctx.reply("Hello! 👋 I am TechStore's AI consultant. I can help you choose electronics, compare prices, and answer any questions in your preferred language! How can I help you today?\n\n(გამარჯობა! 👋 მე ვარ TechStore-ის AI კონსულტანტი. შემიძლია გიპასუხოთ ქართულად ან ნებისმიერ ენაზე!)");
});

bot.on('text', async (ctx) => {
  const chatId = `tg_${ctx.message.chat.id}`;
  const userMessage = ctx.message.text;

  try {
    const responseText = await processAIChat({ sessionId: chatId, userMessage });
    await ctx.reply(responseText);
  } catch (error) {
    console.error('❌ [Telegram Bot] Error handling message:', error);
    await ctx.reply('Sorry, a technical error occurred. Please try again later. / ბოდიში, ტექნიკური შეცდომა მოხდა. გთხოვთ, სცადოთ მოგვიანებით.');
  }
});

// Start Express Server
app.listen(PORT, async () => {
  console.log(`Express server is running on http://localhost:${PORT}`);
  // Initialize RAG embeddings from Google Sheets
  await initializeRAG();
});

// Start Telegram Bot
bot.launch().then(() => {
  console.log('Telegram bot is running');
}).catch((err) => {
  console.error('Failed to start Telegram bot:', err);
});

// Graceful Shutdown
process.once('SIGINT', () => {
  bot.stop('SIGINT');
  process.exit(0);
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  process.exit(0);
});
