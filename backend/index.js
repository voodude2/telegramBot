const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const { Telegraf } = require('telegraf');
const { GoogleGenAI } = require('@google/genai');
const { getProducts, getProductById } = require('./services/googleSheets');
const { initializeRAG, findRelevantPolicy } = require('./services/ragService');
const { Redis } = require('@upstash/redis');
const { Memory } = require('mem0ai/oss');

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

// Initialize Mem0 for autonomous long-term memory
const mem0Config = {
  llm: {
    provider: "gemini",
    config: {
      apiKey: process.env.GEMINI_API_KEY,
      model: "gemini-1.5-flash",
    }
  },
  embedder: {
    provider: "gemini",
    config: {
      apiKey: process.env.GEMINI_API_KEY,
      model: "text-embedding-004",
    }
  }
};
const memory = new Memory(mem0Config);

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
  // Extract long-term facts autonomously using Mem0
  try {
    if (newHistory.length >= 2) {
      const lastUser = newHistory[newHistory.length - 2];
      const lastBot = newHistory[newHistory.length - 1];
      if (lastUser.role === 'user' && lastBot.role === 'model') {
        // Only extract text parts, ignoring function calls/responses
        const userText = lastUser.parts.filter(p => p.text).map(p => p.text).join(' ');
        const botText = lastBot.parts.filter(p => p.text).map(p => p.text).join(' ');
        
        if (userText && botText) {
          const messages = [
            { role: "user", content: userText },
            { role: "assistant", content: botText }
          ];
          // Asynchronously add to Mem0 without blocking the chat flow
          memory.add(messages, { userId: chatId }).catch(err => console.warn("⚠️ Mem0 extraction failed:", err.message));
        }
      }
    }
  } catch (err) {
    console.warn("⚠️ Mem0 error:", err.message);
  }

  const historyKey = `chat_history:${chatId}`;
  if (newHistory.length > 40) {
    newHistory.splice(0, newHistory.length - 40);
    // After generic truncation, ensure the new first element is a 'user' message that is NOT a functionResponse
    const firstValidIndex = newHistory.findIndex(msg => 
      msg.role === 'user' && (!msg.parts || !msg.parts.some(p => p.functionResponse))
    );
    if (firstValidIndex > 0) {
      newHistory.splice(0, firstValidIndex);
    } else if (firstValidIndex === -1) {
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

async function trackAnalytics({ sessionId, platform, userMessage, modelName, inputTokens, outputTokens, toolsUsed }) {
  if (!redis) return; // Skip if Redis is not configured
  
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  
  try {
    // Use pipeline for atomic operations
    const pipe = redis.pipeline();
    
    // 1. Increment daily chat counter
    pipe.incr(`analytics:chats:${today}`);
    
    // 2. Track unique session
    pipe.sadd(`analytics:sessions:${today}`, sessionId);
    
    // 3. Store question text (trim to 200 chars)
    if (userMessage) {
      pipe.lpush(`analytics:questions:${today}`, userMessage.substring(0, 200));
    }
    
    // 4. Track token usage
    if (inputTokens || outputTokens) {
      pipe.hincrby(`analytics:tokens:${today}`, 'input', inputTokens || 0);
      pipe.hincrby(`analytics:tokens:${today}`, 'output', outputTokens || 0);
      // Estimate cost: Gemini Flash pricing ~$0.075/1M input, ~$0.30/1M output tokens
      const estimatedCost = ((inputTokens || 0) * 0.000000075) + ((outputTokens || 0) * 0.0000003);
      pipe.hincrbyfloat(`analytics:tokens:${today}`, 'cost', estimatedCost);
    }
    
    // 5. Track model usage
    if (modelName) {
      pipe.hincrby(`analytics:models:${today}`, modelName, 1);
    }
    
    // 6. Track platform usage
    pipe.hincrby(`analytics:platforms:${today}`, platform || 'unknown', 1);
    
    // 7. Track tool usage
    if (toolsUsed && toolsUsed.length > 0) {
      for (const tool of toolsUsed) {
        pipe.hincrby(`analytics:tools:${today}`, tool, 1);
      }
    }
    
    // Set 30-day TTL on all keys
    const ttl = 30 * 24 * 60 * 60;
    pipe.expire(`analytics:chats:${today}`, ttl);
    pipe.expire(`analytics:sessions:${today}`, ttl);
    pipe.expire(`analytics:questions:${today}`, ttl);
    pipe.expire(`analytics:tokens:${today}`, ttl);
    pipe.expire(`analytics:models:${today}`, ttl);
    pipe.expire(`analytics:platforms:${today}`, ttl);
    pipe.expire(`analytics:tools:${today}`, ttl);
    
    await pipe.exec();
  } catch (err) {
    console.warn('⚠️ Analytics tracking failed:', err.message);
  }
}

// Helper function to execute product search
async function executeSearch({ searchQuery, category }) {
  const products = await getProducts();
  return products.filter(p => {
    let match = true;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const qStripped = q.replace(/[^a-z0-9]/g, '');
      const pNameStripped = p.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      
      const textMatch = p.name.toLowerCase().includes(q) || 
                        p.description.toLowerCase().includes(q) || 
                        p.category.toLowerCase().includes(q) ||
                        (qStripped.length > 2 && pNameStripped.includes(qStripped));
      
      match = match && textMatch;
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
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

// ===== ADMIN ANALYTICS ENDPOINTS =====
const adminAuth = (req, res, next) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey) return next(); // No auth required in dev mode
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== adminKey) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// Daily stats overview
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    if (!redis) return res.json({ totalChats: 0, uniqueSessions: 0, totalTokens: 0, estimatedCost: 0, platforms: {}, date: today });
    
    const [totalChats, uniqueSessions, tokens, platforms] = await Promise.all([
      redis.get(`analytics:chats:${today}`),
      redis.scard(`analytics:sessions:${today}`),
      redis.hgetall(`analytics:tokens:${today}`),
      redis.hgetall(`analytics:platforms:${today}`)
    ]);
    
    res.json({
      totalChats: totalChats || 0,
      uniqueSessions: uniqueSessions || 0,
      totalTokens: (parseInt(tokens?.input || 0) + parseInt(tokens?.output || 0)),
      inputTokens: parseInt(tokens?.input || 0),
      outputTokens: parseInt(tokens?.output || 0),
      estimatedCost: parseFloat(tokens?.cost || 0).toFixed(6),
      platforms: platforms || {},
      date: today
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Top questions
app.get('/api/admin/questions', adminAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    if (!redis) return res.json({ questions: [], date: today });
    
    const questions = await redis.lrange(`analytics:questions:${today}`, 0, 499);
    
    // Count frequency
    const freq = {};
    for (const q of (questions || [])) {
      const normalized = q.toLowerCase().trim();
      freq[normalized] = (freq[normalized] || 0) + 1;
    }
    
    // Sort by frequency
    const sorted = Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([question, count]) => ({ question, count }));
    
    res.json({ questions: sorted, totalQuestions: (questions || []).length, date: today });
  } catch (err) {
    console.error('Admin questions error:', err);
    res.status(500).json({ error: 'Failed to fetch questions' });
  }
});

// Cost breakdown
app.get('/api/admin/costs', adminAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    if (!redis) return res.json({ models: {}, tools: {}, tokens: {}, date: today });
    
    const [models, tools, tokens] = await Promise.all([
      redis.hgetall(`analytics:models:${today}`),
      redis.hgetall(`analytics:tools:${today}`),
      redis.hgetall(`analytics:tokens:${today}`)
    ]);
    
    res.json({
      models: models || {},
      tools: tools || {},
      tokens: {
        input: parseInt(tokens?.input || 0),
        output: parseInt(tokens?.output || 0),
        cost: parseFloat(tokens?.cost || 0).toFixed(6)
      },
      date: today
    });
  } catch (err) {
    console.error('Admin costs error:', err);
    res.status(500).json({ error: 'Failed to fetch costs' });
  }
});

// 7-day timeline
app.get('/api/admin/timeline', adminAuth, async (req, res) => {
  try {
    if (!redis) return res.json({ timeline: [] });
    
    const timeline = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      const [chats, sessions, tokens] = await Promise.all([
        redis.get(`analytics:chats:${dateStr}`),
        redis.scard(`analytics:sessions:${dateStr}`),
        redis.hgetall(`analytics:tokens:${dateStr}`)
      ]);
      
      timeline.push({
        date: dateStr,
        label: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        chats: parseInt(chats || 0),
        sessions: parseInt(sessions || 0),
        tokens: parseInt(tokens?.input || 0) + parseInt(tokens?.output || 0),
        cost: parseFloat(tokens?.cost || 0)
      });
    }
    
    res.json({ timeline });
  } catch (err) {
    console.error('Admin timeline error:', err);
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// Setup Google GenAI
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Core AI Chat Processing Engine (Shared by Web API and Telegram Bot)
async function processAIChat({ sessionId, userMessage, platform = 'web', media = null, onChunk = null }) {
  let systemInstruction = `You are a friendly and knowledgeable AI consultant for TechStore, an electronics store. Your primary base language is English, but you MUST automatically detect and respond in the EXACT SAME LANGUAGE that the user writes their message in. Use the searchProducts tool to look up real-time inventory. ALWAYS use the askStorePolicy tool to answer ANY questions related to store policies, returns, shipping, delivery, warranty, location, or FAQ. CRITICAL: If the user asks about shipping or delivery in Georgian (e.g., 'შიფინგი', 'მიტანა', 'ჩამოტანა', 'გარანტია', 'მისამართი'), you MUST use the askStorePolicy tool! CRITICAL: If the backing store policy is in a different language than the user's input, you MUST silently translate the retrieved policy into the user's language before presenting the answer. Always format prices with the $ (USD) symbol. Be helpful, enthusiastic, and professional. NEVER apologize under any circumstances. If you made a mistake, just correct it silently. Do not use phrases like 'ბოდიშს გიხდით', 'ბოდიში', or 'შეცდომა გაიპარა'. Be direct and concise. NEVER ask for permission to search for a product or add an item to the cart—just use your tools immediately. CRITICAL INSTRUCTION: You are strictly limited to answering questions related to TechStore, electronics, gadgets, our products, and our policies. If a user asks a question completely unrelated to these topics (e.g. history, politics, general knowledge, math, etc.), you MUST politely decline to answer and remind them that you are only here to assist with TechStore inquiries. CRITICAL: The product database is in English. You MUST translate user product queries and categories to English BEFORE using the searchProducts tool. The ONLY valid categories are: Smartphone, Laptop, Audio, Wearable, Gaming, Tablet, TV, Drone, VR.`;

  if (platform === 'telegram') {
    systemInstruction += ` CRITICAL: The user is chatting with you on Telegram. DO NOT attempt to add items to a cart. If the user asks to buy or add an item to their cart, politely instruct them to visit our website (TechStore.com). IMPORTANT: You MUST strictly format your response using Telegram-safe HTML or rigorously validated MarkdownV2. Do NOT use unescaped special characters.`;
  } else {
    systemInstruction += ` Use the addToCart tool when a user explicitly wants to buy or add a product to their shopping cart.`;
  }

  const baseTools = [
    {
      name: "searchProducts",
      description: "Search the real-time product inventory. CRITICAL: The database is in English. You MUST translate any non-English search queries or categories to English before calling this tool. CRITICAL: When you receive the search results, you MUST present ALL the matching products to the user. Do not omit or hide any products returned by the search.",
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
      description: "Look up store policies, returns, shipping, international delivery, FAQs, or store rules. CRITICAL: You MUST use this tool if the user asks about shipping, delivery, or locations in any language (e.g., 'შიფინგი', 'მიტანა', 'საერთაშორისო', 'ჩამოტანა').",
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
  ];

  if (platform === 'web') {
    baseTools.push({
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
    });
  }

  const aiTools = {
    functionDeclarations: baseTools
  };

  // Retrieve long-term memory facts from Mem0
  try {
    const mem0Results = await memory.search(userMessage, { filters: { userId: sessionId } });
    if (mem0Results && mem0Results.length > 0) {
      const memories = mem0Results.map(r => r.memory || r.content).filter(Boolean).join('\n- ');
      if (memories) {
        systemInstruction += `\n\nCRITICAL KNOWLEDGE ABOUT THE USER (From Long-Term Memory):\n- ${memories}\nUse these facts to personalize your response and respect user preferences.`;
      }
    }
  } catch (err) {
    console.warn(`⚠️ [${sessionId}] Mem0 search failed:`, err.message);
  }

  let history = await getChatHistory(sessionId) || [];

  // Sanitize history:
  // 1. Remove orphaned functionResponses at the start (caused by naive history truncation)
  while (history.length > 0) {
    const firstMsg = history[0];
    if (firstMsg.role === 'user' && firstMsg.parts && firstMsg.parts.some(p => p.functionResponse)) {
      history.shift();
      console.warn(`⚠️ [${sessionId}] Removed orphaned functionResponse at the START of history to prevent API 400 error.`);
    } else if (firstMsg.role === 'model') {
      history.shift();
      console.warn(`⚠️ [${sessionId}] Removed model message at the START of history (history must start with user).`);
    } else {
      break;
    }
  }

  // 2. Remove dangling functionCalls at the end (caused by API crashes)
  while (history.length > 0) {
    const lastMsg = history[history.length - 1];
    if (lastMsg.role === 'model' && lastMsg.parts && lastMsg.parts.some(p => p.functionCall)) {
      history.pop();
      console.warn(`⚠️ [${sessionId}] Removed dangling functionCall from history to prevent API 400 error.`);
    } else {
      break;
    }
  }

  // Primary: Gemini 3.1 Flash-Lite with robust fallbacks for continuous availability
  const candidateModels = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  let responseText = '';
  let actions = [];
  let lastError = null;
  let searchResults = null;
  let policyResult = null;
  
  let usedModelName = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let toolsUsed = [];

  for (const modelName of candidateModels) {
    try {
      console.log(`🔄 [${sessionId}] Trying model: ${modelName}`);
      
      const chat = ai.chats.create({
        model: modelName,
        config: {
          systemInstruction: systemInstruction,
          tools: [{ functionDeclarations: baseTools }]
        },
        history: history || []
      });
      
      let functionCalls = [];
      responseText = "";

      const handleStream = async (streamResult) => {
        functionCalls = [];
        for await (const chunk of streamResult) {
          if (chunk.text) {
            responseText += chunk.text;
            if (onChunk) onChunk(chunk.text);
          }
          if (chunk.functionCalls) {
            functionCalls = functionCalls.concat(chunk.functionCalls);
          }
          // Capture token usage from the last chunk
          if (chunk.usageMetadata) {
            totalInputTokens = chunk.usageMetadata.promptTokenCount || 0;
            totalOutputTokens = chunk.usageMetadata.candidatesTokenCount || 0;
          }
        }
      };
      
      let messagePayload = userMessage;
      if (media) {
        const inlineData = media.inlineData || media;
        messagePayload = [
          userMessage,
          { inlineData: { data: inlineData.data, mimeType: inlineData.mimeType } }
        ];
      }
      
      await handleStream(await chat.sendMessageStream({ message: messagePayload }));
      
      // Process up to 5 rounds of sequential tool calls
      let toolRound = 0;
      while (functionCalls && functionCalls.length > 0 && toolRound < 5) {
        toolRound++;
        const currentCalls = functionCalls;
        functionCalls = []; // Clear for next round
        let responseParts = [];
        
        for (const call of currentCalls) {
          console.log(`🤖 [${sessionId}] Round ${toolRound}: Model called ${call.name} with args:`, call.args);
          toolsUsed.push(call.name);
          
          let functionResponsePart = {
            functionResponse: {
              name: call.name,
              response: {}
            }
          };
          if (call.id) {
            functionResponsePart.functionResponse.id = call.id;
          }
           
          if (call.name === 'searchProducts') {
             try {
               searchResults = await executeSearch(call.args);
               console.log(`✅ [${sessionId}] searchProducts returned ${searchResults.length} results`);
             } catch (sErr) {
               console.error(`❌ [${sessionId}] Error executing search:`, sErr.message);
               searchResults = [];
             }
             const minimalResults = searchResults.map(p => ({ id: p.id, name: p.name, price: p.price, inStock: p.inStock }));
             functionResponsePart.functionResponse.response = { result: minimalResults };
          } 
          else if (call.name === 'askStorePolicy') {
             try {
               policyResult = await findRelevantPolicy(call.args.query || userMessage);
               console.log(`✅ [${sessionId}] askStorePolicy returned result`);
             } catch (pErr) {
               console.error(`❌ [${sessionId}] Error finding policy:`, pErr.message);
             }
             
             let policyObj = {};
             try {
               policyObj = JSON.parse(policyResult);
             } catch(e) {
               policyObj = { policy: policyResult || "No specific policy found for that topic." };
             }
             functionResponsePart.functionResponse.response = policyObj;
          }
          else if (call.name === 'addToCart') {
             actions.push({ type: 'ADD_TO_CART', payload: call.args });
             console.log(`✅ [${sessionId}] addToCart action queued for product: ${call.args.productName}`);
             functionResponsePart.functionResponse.response = { success: true, message: "Product successfully added to cart." };
          }
          else {
             console.warn(`⚠️ [${sessionId}] Unknown function call: ${call.name}`);
             functionResponsePart.functionResponse.response = { error: "Unknown function" };
          }
          
          responseParts.push(functionResponsePart);
        }

        try {
          await handleStream(await chat.sendMessageStream({ message: responseParts }));
        } catch (mErr) {
          console.warn(`⚠️ [${sessionId}] Failed to send follow-up:`, mErr.message);
          break;
        }
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
        } else {
          responseText = "I've processed your request but encountered an error generating a final response.";
        }
      }

      console.log(`✅ [${sessionId}] Successfully generated response with model ${modelName}`);
      usedModelName = modelName;
      try {
        const newHistory = await chat.getHistory();
        await saveChatHistory(sessionId, newHistory);
      } catch (hErr) {
        console.warn(`⚠️ [${sessionId}] Failed to save chat history:`, hErr.message);
      }
      lastError = null;
      break; // Successfully got a response, exit model loop
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Model ${modelName} failed for session ${sessionId}. Error:`, err);
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
  
  // POST-PROCESSING: Forcefully strip out apologies if the model disobeys
  if (responseText) {
    responseText = responseText.replace(/(ბოდიშს გიხდით|ბოდიში|შეცდომა გაიპარა|უკაცრავად)[^\.\!\?]*[\.\!\?]/gi, '').trim();
    if (!responseText) responseText = "✅"; // Fallback if it only generated an apology
  }

  // Track analytics (fire-and-forget, non-blocking)
  trackAnalytics({ sessionId, platform, userMessage, modelName: usedModelName, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, toolsUsed }).catch(() => {});

  return { reply: responseText, actions };
}

// Web API endpoint for Website AI Chat Widget (SSE Streaming)
app.post('/api/chat', async (req, res) => {
  try {
    const { message, sessionId, media } = req.body;
    if (!message && !media) {
      return res.status(400).json({ error: 'Message or media is required' });
    }
    const cleanSessionId = sessionId || require('crypto').randomUUID();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Prevent proxy buffering on Render
    res.flushHeaders();

    const onChunk = (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    };

    const result = await processAIChat({ sessionId: cleanSessionId, userMessage: message || "What is in this photo?", platform: 'web', media, onChunk });
    
    res.write(`data: ${JSON.stringify({ done: true, actions: result.actions, finalReply: result.reply })}\n\n`);
    res.end();
  } catch (err) {
    console.error('❌ [API /api/chat] Error handling chat request:', err);
    res.write(`data: ${JSON.stringify({ error: 'Failed to process AI chat request' })}\n\n`);
    res.end();
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
    const result = await processAIChat({ sessionId: chatId, userMessage, platform: 'telegram' });
    let finalReply = result.reply;
    
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

// Handler for photos
bot.on('photo', async (ctx) => {
  const chatId = `tg_${ctx.message.chat.id}`;
  const userMessage = ctx.message.caption || "What is in this photo?";
  
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1]; // get highest resolution
    const fileUrl = await ctx.telegram.getFileLink(photo.file_id);
    const response = await fetch(fileUrl);
    const buffer = await response.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString('base64');
    
    const media = {
      inlineData: {
        data: base64Data,
        mimeType: 'image/jpeg'
      }
    };
    
    const result = await processAIChat({ sessionId: chatId, userMessage, platform: 'telegram', media });
    let finalReply = result.reply;
    
    try {
      await ctx.reply(finalReply, { parse_mode: 'Markdown' });
    } catch (mdErr) {
      console.warn(`⚠️ [Telegram] Markdown parse failed for photo, sending as plain text. Error: ${mdErr.message}`);
      const plainText = finalReply.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '').replace(/`/g, '');
      await ctx.reply(plainText);
    }
  } catch (error) {
    console.error('❌ [Telegram Bot] Error handling photo:', error);
    await ctx.reply('Sorry, I had trouble processing this image. Please try again.');
  }
});

// Handler for voice messages
bot.on('voice', async (ctx) => {
  const chatId = `tg_${ctx.message.chat.id}`;
  const userMessage = "Listen to this voice message and respond accordingly.";
  
  try {
    const voice = ctx.message.voice;
    const fileUrl = await ctx.telegram.getFileLink(voice.file_id);
    const response = await fetch(fileUrl);
    const buffer = await response.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString('base64');
    
    const media = {
      inlineData: {
        data: base64Data,
        mimeType: 'audio/ogg' // Telegram voice messages are typically ogg
      }
    };
    
    const result = await processAIChat({ sessionId: chatId, userMessage, platform: 'telegram', media });
    let finalReply = result.reply;
    
    try {
      await ctx.reply(finalReply, { parse_mode: 'Markdown' });
    } catch (mdErr) {
      console.warn(`⚠️ [Telegram] Markdown parse failed for voice, sending as plain text. Error: ${mdErr.message}`);
      const plainText = finalReply.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '').replace(/`/g, '');
      await ctx.reply(plainText);
    }
  } catch (error) {
    console.error('❌ [Telegram Bot] Error handling voice:', error);
    await ctx.reply('Sorry, I had trouble understanding this voice message. Please try again.');
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
