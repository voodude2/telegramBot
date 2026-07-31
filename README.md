# 🤖 TechStore AI Assistant & E-Commerce Platform

![TechStore AI Assistant](https://images.unsplash.com/photo-1518770660439-4636190af475?q=80&w=1200&auto=format&fit=crop)

A modern, AI-powered e-commerce platform featuring a fully functional frontend store and an intelligent AI assistant. The AI consultant is accessible both via a **Web Chat Widget** and a **Telegram Bot**, providing users with real-time product inventory searches and precise store policy answers using Retrieval-Augmented Generation (RAG).

---

## ✨ Key Features

* **Omnichannel AI Consultant**: Seamlessly interact with the AI assistant via Telegram or directly on the e-commerce website.
* **Real-time Inventory Search**: The AI can execute live searches against the store's product database to recommend in-stock items with pricing.
* **RAG-Powered Policy Engine**: Uses Google Gemini Vector Embeddings to understand and answer store policy questions (returns, shipping, FAQs) backed by a Google Sheet database.
* **Multi-Language Support**: The AI automatically detects and responds in the user's native language.
* **Persistent Chat Memory**: Conversations are remembered across sessions using Upstash Redis (with seamless in-memory fallback).
* **Modern Web Storefront**: A sleek, responsive e-commerce UI built with React, Vite, and Tailwind CSS.
* **Graceful Error Handling**: Resilient AI generation with fallback mechanisms to ensure a smooth user experience even during API latency.

---

## 🛠️ Tech Stack

### Frontend
* **Framework**: React 18 (via Vite)
* **Styling**: Tailwind CSS
* **Components**: Custom UI components with a futuristic, premium aesthetic (glassmorphism, gradient texts)

### Backend
* **Environment**: Node.js & Express
* **AI Engine**: Google Generative AI (`@google/generative-ai` - Gemini 1.5 Flash / Flash-8B)
* **Bot Framework**: Telegraf (Telegram Bot API)
* **Database (Products & RAG)**: Google Sheets API
* **Caching / Memory**: Upstash Redis (Serverless Redis)

---

## 📂 Project Structure

```text
telegram-ai-agent/
├── backend/                  # Node.js backend server and Telegram bot
│   ├── index.js              # Main Express server and Telegraf initialization
│   ├── services/
│   │   ├── googleSheets.js   # Fetches live product inventory from Google Sheets
│   │   └── ragService.js     # Manages Vector Embeddings and RAG policy lookup
│   ├── Dockerfile            # Container configuration for deployment
│   └── package.json
└── frontend/                 # React frontend application
    ├── src/
    │   ├── App.jsx           # Main E-commerce storefront
    │   ├── components/       # Reusable UI components (Navbar, AIChatWidget, etc.)
    │   └── index.css         # Tailwind configuration and custom styling
    ├── vite.config.js
    └── package.json
```

---

## 🚀 Getting Started

### Prerequisites
* Node.js (v18 or higher)
* A Telegram Bot Token (from [@BotFather](https://t.me/botfather))
* Google Gemini API Key
* Google Service Account Credentials (for Google Sheets access)
* Upstash Redis credentials (optional, for persistent chat memory)

### 1. Environment Setup

Navigate to the `backend` directory and create a `.env` file:
```bash
cd backend
cp .env.example .env
```
Fill in the following variables in `backend/.env`:
```env
PORT=3000
FRONTEND_URL=http://localhost:5173
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GEMINI_API_KEY=your_gemini_api_key

# Google Sheets Config
GOOGLE_SERVICE_ACCOUNT_EMAIL=your_service_account_email
GOOGLE_PRIVATE_KEY="your_private_key"
SPREADSHEET_ID=your_spreadsheet_id

# Upstash Redis (Optional for chat history persistence)
UPSTASH_REDIS_REST_URL=your_redis_url
UPSTASH_REDIS_REST_TOKEN=your_redis_token
```

### 2. Run the Backend

```bash
cd backend
npm install
npm start
```
*The server will start on port 3000, initialize the RAG vector embeddings, and start listening for Telegram messages.*

### 3. Run the Frontend

In a new terminal window:
```bash
cd frontend
npm install
npm run dev
```
*The React app will be available at `http://localhost:5173`. You can interact with the floating AI Assistant on the bottom right.*

---

## ☁️ Deployment

The project is fully prepared for containerized deployment (e.g., on Render, Heroku, or Railway). 

### Backend (Render Web Service)
1. Connect your GitHub repository to Render.
2. Select the `backend` folder as the Root Directory.
3. Use `npm install` for the Build Command and `npm start` for the Start Command.
4. (Optional) Alternatively, use the provided `Dockerfile`.
5. Add all the environment variables in the Render Dashboard.

### Frontend (Static Site)
1. Deploy the `frontend` folder to Vercel, Netlify, or Render Static Sites.
2. Ensure you set the `VITE_API_URL` environment variable to point to your deployed backend URL.

---

## 🧠 How the RAG Pipeline Works

1. **Initialization**: On server startup, `ragService.js` downloads the `FAQ_Policies` tab from your connected Google Sheet.
2. **Embedding**: Each Q/A pair is converted into a 768-dimensional mathematical vector using Google's `text-embedding-004` (or `gemini-embedding-2`) model.
3. **Retrieval**: When a user asks a policy-related question, the AI triggers the `askStorePolicy` tool. The user's query is embedded, and a cosine similarity search finds the closest matching policy in memory.
4. **Generation**: The matched policy is fed back to the Gemini model in a strict `functionResponse` format, allowing the AI to generate a natural, conversational answer based on actual store rules.

---

## 🤝 Contributing
Contributions, issues, and feature requests are welcome! Feel free to check the issues page.

## 📝 License
This project is open-source and available under the MIT License.
