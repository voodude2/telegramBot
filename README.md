# TechStore — E-commerce + AI Telegram Agent

A full-stack MVP portfolio project featuring an e-commerce storefront and an AI-powered Telegram bot consultant.

## 🏗 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, Vite 6, Tailwind CSS v4 |
| **Backend** | Node.js, Express 4 |
| **AI Agent** | Telegraf (Telegram Bot), Google Gemini 1.5 Flash |
| **Database** | In-memory mock data (JS array) |

## 📁 Project Structure

```
telegram-ai-agent/
├── backend/
│   ├── data/
│   │   └── products.js       # Mock product database
│   ├── index.js               # Express API + Telegram Bot + Gemini AI
│   ├── package.json
│   ├── .env.example
│   └── .gitignore
├── frontend/
│   ├── src/
│   │   ├── App.jsx            # Main React app (all components)
│   │   ├── index.css          # Tailwind v4 + custom theme
│   │   └── main.jsx           # React entry point
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── README.md
```

## 🚀 Quick Start

### 1. Clone & Setup Environment

```bash
# Navigate to the backend
cd backend

# Copy the environment template and add your keys
cp .env.example .env
```

Edit `.env` with your actual keys:
```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
GEMINI_API_KEY=your_gemini_api_key_here
PORT=3000
```

### 2. Install & Run Backend

```bash
cd backend
npm install
npm run dev    # Uses nodemon for hot reload
```

The Express API will start at `http://localhost:3000`.

### 3. Install & Run Frontend

```bash
cd frontend
npm install
npm run dev
```

The React app will start at `http://localhost:5173`.

### 4. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| GET | `/api/products` | Get all products |
| GET | `/api/products/:id` | Get single product |

### 5. Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Get a [Gemini API key](https://aistudio.google.com/apikey)
3. Add both tokens to your `.env` file
4. Start the backend — the bot launches automatically
5. Send `/start` to your bot and chat in any language — it responds in Georgian 🇬🇪

## 📝 License

MIT
