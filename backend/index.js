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
const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.replace(/^"|"$/g, '').trim();
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.replace(/^"|"$/g, '').trim();
const hasRedis = Boolean(redisUrl && redisToken);
const redis = hasRedis
  ? new Redis({
      url: redisUrl,
      token: redisToken,
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
    // After generic truncation, ensure the new first element is a 'user' message
    const firstUserIndex = newHistory.findIndex(msg => msg.role === 'user');
    if (firstUserIndex > 0) {
      newHistory.splice(0, firstUserIndex);
    } else if (firstUserIndex === -1) {
      newHistory.length = 0;
    }
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
  const systemInstruction = `You are a friendly and knowledgeable AI consultant for TechStore, an electronics store. Your primary base language is English, but you MUST automatically detect and respond in the EXACT SAME LANGUAGE that the user writes their message in. Use the searchProducts tool to look up real-time inventory. Use the askStorePolicy tool to answer ANY questions related to store policies, returns, shipping, FAQ, etc. Use the addToCart tool when a user explicitly wants to buy or add a product to their shopping cart. Always format prices with the $ (USD) symbol. Be helpful, enthusiastic, and professional. CRITICAL INSTRUCTION: You are strictly limited to answering questions related to TechStore, electronics, gadgets, our products, and our policies. If a user asks a question completely unrelated to these topics (e.g. history, politics, general knowledge, math, etc.), you MUST politely decline to answer and remind them that you are only here to assist with TechStore inquiries. CRITICAL: The product database is in English. You MUST translate user product queries and categories to English BEFORE using the searchProducts tool. The ONLY valid categories are: Smartphone, Laptop, Audio, Wearable, Gaming, Tablet, TV, Drone, VR.`;

  const searchProductsTool = {
    functionDeclarations: [
      {
        name: "searchProducts",
        description: "Search the real-time product inventory. CRITICAL: The database is in English. You MUST translate any non-English search queries or categories to English before calling this tool.",
        parameters: {
          type: "OBJECT",
          properties: {
            searchQuery: {
              type: "STRING",
              description: "The English search query to match against product names or descriptions."
            },
            category: {
              type: "STRING",
              description: "The English product category to filter by.",
              enum: ["Smartphone", "Laptop", "Audio", "Wearable", "Gaming", "Tablet", "TV", "Drone", "VR"]
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
      },
      {
        name: "addToCart",
        description: "Add a specific product to the user's shopping cart. Use this when the user explicitly asks to buy or add a product to their cart.",
        parameters: {
          type: "OBJECT",
          properties: {
            productId: {
              type: "NUMBER",
              description: "The ID of the product to add to the cart."
            },
            productName: {
              type: "STRING",
              description: "The name of the product being added."
            }
          },
          required: ["productId", "productName"]
        }
      }
    ]
  };

  let history = await getChatHistory(sessionId);

  // Primary: Gemini 3.1 Flash-Lite with robust fallbacks for continuous availability
  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let responseText = '';
  let actions = [];
  let lastError = null;
  let searchResults = null;
  let policyResult = null;

  for (const modelName of candidateModels) {
    try {
      console.log(`🔄 [${sessionId}] Trying model: ${modelName}`);
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemInstruction,
        tools: [searchProductsTool],
      });

      const clonedHistory = JSON.parse(JSON.stringify(history));
      // Sanitize history: Gemini SDK requires history to start with a 'user' role
      const firstUserIdx = clonedHistory.findIndex(msg => msg.role === 'user');
      if (firstUserIdx > 0) {
        clonedHistory.splice(0, firstUserIdx);
      } else if (firstUserIdx === -1) {
        clonedHistory.length = 0;
      }
      
      let chat = model.startChat({ history: clonedHistory });
      
      let result = await chat.sendMessage(userMessage);
      
      let functionCalls = [];
      try {
        functionCalls = result.response.functionCalls ? result.response.functionCalls() : [];
      } catch (fcErr) {
        console.warn(`⚠️ [${sessionId}] Error reading functionCalls:`, fcErr.message);
      }
      
      // Process up to 3 rounds of sequential tool calls (handles multi-step tool usage)
      let toolRound = 0;
      while (functionCalls && functionCalls.length > 0 && toolRound < 3) {
        toolRound++;
        const call = functionCalls[0];
        console.log(`🤖 [${sessionId}] Round ${toolRound}: Model called ${call.name} with args:`, call.args);
         
        if (call.name === 'searchProducts') {
           try {
             searchResults = await executeSearch(call.args);
             console.log(`✅ [${sessionId}] searchProducts returned ${searchResults.length} results`);
           } catch (sErr) {
             console.error(`❌ [${sessionId}] Error executing search:`, sErr.message);
             searchResults = [];
           }
           
           const functionResponseParts = [{
             functionResponse: {
               name: 'searchProducts',
               response: { result: searchResults }
             }
           }];
           try {
             result = await chat.sendMessage(functionResponseParts);
           } catch (mErr) {
             console.warn(`⚠️ [${sessionId}] Failed to send search follow-up:`, mErr.message);
             // Build fallback response from search results directly
             if (searchResults && searchResults.length > 0) {
               responseText = "Here are the matching items found in our live inventory:\n\n" + 
                 searchResults.map(p => `• **${p.name}** - $${p.price} (${p.inStock ? 'In Stock' : 'Out of Stock'})\n  _${p.description}_`).join('\n\n');
             } else {
               responseText = "We currently don't have exact matches in stock for that item. Feel free to ask about our smartphones, laptops, audio gear, or accessories!";
             }
             break;
           }
        } 
        else if (call.name === 'askStorePolicy') {
           try {
             policyResult = await findRelevantPolicy(call.args.query || userMessage);
             console.log(`✅ [${sessionId}] askStorePolicy returned result`);
           } catch (pErr) {
             console.error(`❌ [${sessionId}] Error finding policy:`, pErr.message);
           }
           
           const functionResponseParts = [{
             functionResponse: {
               name: 'askStorePolicy',
               response: { policy: policyResult || "No specific policy found for that topic." }
             }
           }];
           try {
             result = await chat.sendMessage(functionResponseParts);
           } catch (mErr) {
             console.warn(`⚠️ [${sessionId}] Failed to send policy follow-up:`, mErr.message);
             if (policyResult) responseText = policyResult;
             break;
           }
        }
        else if (call.name === 'addToCart') {
           actions.push({ type: 'ADD_TO_CART', payload: call.args });
           console.log(`✅ [${sessionId}] addToCart action queued for product: ${call.args.productName}`);
           
           const functionResponseParts = [{
             functionResponse: {
               name: 'addToCart',
               response: { success: true, message: "Product successfully added to cart. Tell the user it has been added." }
             }
           }];
           try {
             result = await chat.sendMessage(functionResponseParts);
           } catch (mErr) {
             console.warn(`⚠️ [${sessionId}] Failed to send addToCart follow-up:`, mErr.message);
             responseText = `✅ ${call.args.productName} has been added to your cart!`;
             break;
           }
        }
        else {
           console.warn(`⚠️ [${sessionId}] Unknown function call: ${call.name}`);
           break;
        }

        // Check if the model wants another tool call
        try {
          functionCalls = result.response.functionCalls ? result.response.functionCalls() : [];
        } catch (fcErr) {
          functionCalls = [];
        }
      }

      // Extract text response
      try {
        if (result && result.response) {
          responseText = responseText || result.response.text();
        }
      } catch (e) {
        console.warn(`⚠️ [${sessionId}] Could not extract text from response:`, e.message);
        // Don't overwrite responseText if we already have a fallback
      }

      // Graceful Fallback if model response text is empty after tool execution
      if (!responseText || responseText.trim() === '') {
        if (policyResult) {
          responseText = policyResult;
        } else if (searchResults && searchResults.length > 0) {
          responseText = "Here are the matching items found in our live inventory:\n\n" + 
            searchResults.map(p => `• **${p.name}** - $${p.price} (${p.inStock ? 'In Stock' : 'Out of Stock'})\n  _${p.description}_`).join('\n\n');
        } else if (searchResults && searchResults.length === 0) {
          responseText = "We currently don't have exact matches in stock for that item. Feel free to ask about our smartphones, laptops, audio gear, or accessories!";
        }
      }
      
      if (responseText && responseText.trim() !== '') {
        console.log(`✅ [${sessionId}] Successfully generated response with model ${modelName}`);
        try {
          const newHistory = await chat.getHistory();
          await saveChatHistory(sessionId, newHistory);
        } catch (hErr) {
          console.warn(`⚠️ [${sessionId}] Failed to save chat history:`, hErr.message);
        }
        lastError = null;
        break; // Successfully got a response, exit model loop
      }
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Model ${modelName} failed for session ${sessionId}. Error:`, err.message || err);
    }
  }

  // Final Graceful Error Fallback (Prevents 500 crashes or empty responses)
  if (!responseText || responseText.trim() === '') {
    if (policyResult) {
      return { reply: policyResult, actions };
    }
    if (lastError) {
      console.error(`❌ [processAIChat] All candidate models failed. Final error:`, lastError);
    }
    return { reply: "I am experiencing a temporary connection hiccup with the AI server, but I am still here to assist you! Please try asking your question again.", actions };
  }

  return { reply: responseText, actions };
}

// Web API endpoint for Website AI Chat Widget
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    const cleanSessionId = sessionId || 'web_default_session';
    const result = await processAIChat({ sessionId: cleanSessionId, userMessage: message });
    res.json({ reply: result.reply, actions: result.actions });
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
    const result = await processAIChat({ sessionId: chatId, userMessage });
    let finalReply = result.reply;
    
    // Fallback for Telegram users since they don't have a UI cart
    if (result.actions && result.actions.length > 0) {
      const cartActions = result.actions.filter(a => a.type === 'ADD_TO_CART');
      if (cartActions.length > 0) {
        finalReply += "\n\n🛒 I've prepared these items for your cart! (Since you're on Telegram, this is just a virtual confirmation).";
      }
    }
    
    // Try sending with Markdown formatting; if Telegram can't parse it, send as plain text
    try {
      await ctx.reply(finalReply, { parse_mode: 'Markdown' });
    } catch (mdErr) {
      console.warn(`⚠️ [Telegram] Markdown parse failed, sending as plain text. Error: ${mdErr.message}`);
      // Strip markdown formatting for plain text fallback
      const plainText = finalReply
        .replace(/\*\*/g, '')   // Remove bold **
        .replace(/\*/g, '')     // Remove italic *
        .replace(/_/g, '')      // Remove underline _
        .replace(/`/g, '');     // Remove code `
      await ctx.reply(plainText);
    }
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
