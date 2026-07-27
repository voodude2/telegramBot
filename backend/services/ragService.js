const { JWT } = require('google-auth-library');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// We use the embedding model to convert text to vectors
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: 'gemini-embedding-2' });

// In-memory array to store our pre-computed policy embeddings
// Format: [ { question: string, answer: string, embedding: number[] } ]
let policyKnowledgeBase = [];

/**
 * Calculates the cosine similarity between two vectors (arrays of numbers).
 * Returns a value between -1 and 1, where 1 means identical.
 */
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Uses Gemini to generate an embedding vector for a given text string.
 */
async function generateEmbeddings(text) {
  try {
    const result = await embeddingModel.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error("❌ Error generating embedding:", error.message);
    return null;
  }
}

/**
 * Connects to Google Sheets and fetches the FAQ/Policies.
 */
async function fetchPoliciesFromSheet() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || process.env.SPREADSHEET_ID;

  if (!email || !privateKey || !spreadsheetId) {
    console.warn("⚠️ Google Sheets credentials not configured. RAG will be empty.");
    return [];
  }

  try {
    const { GoogleSpreadsheet } = await import('google-spreadsheet');
    const serviceAccountAuth = new JWT({
      email: email,
      key: privateKey.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
    await doc.loadInfo();
    
    // Find the sheet by title
    const sheet = Object.values(doc.sheetsById).find(s => s.title === 'FAQ_Policies');
    if (!sheet) {
      console.warn("⚠️ Sheet tab named 'FAQ_Policies' not found. Skipping RAG loading.");
      return [];
    }

    const rows = await sheet.getRows();
    const policies = [];

    for (const row of rows) {
      // Assuming columns are named "Question" and "Answer"
      const question = row.get('Question') || '';
      const answer = row.get('Answer') || '';
      if (question && answer) {
        policies.push({ question, answer });
      }
    }
    return policies;
  } catch (err) {
    console.error("❌ Error fetching policies from sheet:", err.message);
    return [];
  }
}

/**
 * Initializes the RAG system by fetching policies and embedding them.
 * This should be called once when the server starts.
 */
async function initializeRAG() {
  console.log("⏳ Initializing RAG pipeline... Fetching policies from Google Sheets...");
  const rawPolicies = await fetchPoliciesFromSheet();
  
  policyKnowledgeBase = []; // Reset just in case
  
  if (rawPolicies.length === 0) {
    console.log("ℹ️ No policies found or sheet not set up. RAG initialized empty.");
    return;
  }

  for (const policy of rawPolicies) {
    // Embed the question (and optionally the answer context) so it matches user queries better
    const textToEmbed = `Question: ${policy.question}\nAnswer: ${policy.answer}`;
    const embedding = await generateEmbeddings(textToEmbed);
    
    if (embedding) {
      policyKnowledgeBase.push({
        question: policy.question,
        answer: policy.answer,
        embedding: embedding
      });
    }
  }
  
  console.log(`✅ [RAG] Initialized ${policyKnowledgeBase.length} policies with embeddings.`);
  
  if (policyKnowledgeBase.length > 0) {
    console.log("აი, როგორ გამოიყურება პირველი წესის ვექტორი (Embedding):");
    console.log(policyKnowledgeBase[0].embedding);
  }
}

/**
 * Finds the most relevant policy given a user query.
 * Compares the embedded user query with the embedded policies using Cosine Similarity.
 */
async function findRelevantPolicy(userQuery) {
  if (policyKnowledgeBase.length === 0) {
    return "I couldn't check the store policies right now because the policy database is empty.";
  }

  const queryEmbedding = await generateEmbeddings(userQuery);
  if (!queryEmbedding) {
    return "I encountered a technical issue while searching the policies. Please ask a human agent.";
  }

  let bestMatch = null;
  let highestScore = -1;

  for (const policy of policyKnowledgeBase) {
    const score = cosineSimilarity(queryEmbedding, policy.embedding);
    if (score > highestScore) {
      highestScore = score;
      bestMatch = policy;
    }
  }

  // We set a threshold for similarity so we don't return completely irrelevant stuff
  // Usually >= 0.70 is decent for text-embedding-004
  if (highestScore > 0.65 && bestMatch) {
    console.log(`🔍 [RAG] Found matching policy (Score: ${(highestScore*100).toFixed(1)}%):`, bestMatch.question);
    return `Relevant Policy found:\nQ: ${bestMatch.question}\nA: ${bestMatch.answer}`;
  } else {
    console.log(`🔍 [RAG] No policy matched strongly enough. Highest score was ${(highestScore*100).toFixed(1)}%`);
    return "I couldn't find a specific store policy related to your question.";
  }
}

module.exports = {
  initializeRAG,
  findRelevantPolicy
};
