const { Telegraf } = require('telegraf');
const config = require('../config');
const { processAIChat } = require('../services/aiChat');

/**
 * Telegram front-end for the shared chat engine.
 *
 * The three handlers (text, photo, voice) were previously near-identical copies
 * of the same reply/format/fallback block; they now differ only in how they build
 * the model input.
 */

const TELEGRAM_MAX_MESSAGE = 4096;
const MAX_DOWNLOAD_BYTES = 15 * 1024 * 1024;

const WELCOME =
  "Hello! 👋 I am TechStore's AI consultant. I can help you choose electronics, compare prices, and answer any questions in your preferred language! How can I help you today?\n\n" +
  '(გამარჯობა! 👋 მე ვარ TechStore-ის AI კონსულტანტი. შემიძლია გიპასუხოთ ქართულად ან ნებისმიერ ენაზე!)';

const GENERIC_ERROR =
  'Sorry, a technical error occurred. Please try again later. / ბოდიში, ტექნიკური შეცდომა მოხდა. გთხოვთ, სცადოთ მოგვიანებით.';

function stripMarkdown(text) {
  return text.replace(/\*\*/g, '').replace(/\*/g, '').replace(/_/g, '').replace(/`/g, '');
}

/**
 * Splits on paragraph, then line, then hard character boundaries. Replies longer
 * than Telegram's 4096-character limit used to fail outright, so a long product
 * list surfaced to the user as a generic error.
 */
function splitMessage(text, limit = TELEGRAM_MAX_MESSAGE) {
  if (text.length <= limit) return [text];

  const chunks = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);
    let cut = window.lastIndexOf('\n\n');
    if (cut < limit * 0.5) cut = window.lastIndexOf('\n');
    if (cut < limit * 0.5) cut = window.lastIndexOf(' ');
    if (cut <= 0) cut = limit;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

/** Sends a reply as Markdown, falling back to plain text if Telegram rejects it. */
async function sendReply(ctx, text) {
  if (!text) return;

  for (const chunk of splitMessage(text)) {
    try {
      await ctx.reply(chunk, { parse_mode: 'Markdown' });
    } catch (err) {
      console.warn(`⚠️  [Telegram] Markdown rejected, resending as plain text: ${err.message}`);
      try {
        await ctx.reply(stripMarkdown(chunk));
      } catch (plainErr) {
        console.error('❌ [Telegram] Could not deliver message:', plainErr.message);
        return;
      }
    }
  }
}

/** Downloads a Telegram file as base64, refusing anything oversized. */
async function downloadAsBase64(ctx, fileId) {
  const fileUrl = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Telegram file download failed: ${response.status}`);

  const declared = Number(response.headers.get('content-length'));
  if (declared && declared > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File is too large (${declared} bytes)`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    throw new Error(`File is too large (${buffer.length} bytes)`);
  }
  return buffer.toString('base64');
}

/**
 * Shared pipeline for every message type. `build` returns the model input for
 * this update; everything after that is identical across handlers.
 */
function handleUpdate(build, errorMessage) {
  return async (ctx) => {
    const sessionId = `tg_${ctx.chat.id}`;
    try {
      await ctx.sendChatAction('typing').catch(() => {});

      const { userMessage, media } = await build(ctx);
      const result = await processAIChat({
        sessionId,
        userMessage,
        platform: 'telegram',
        media,
      });

      await sendReply(ctx, result.reply);
    } catch (err) {
      console.error(`❌ [Telegram] ${sessionId}:`, err);
      await ctx.reply(errorMessage).catch(() => {});
    }
  };
}

function createBot() {
  if (!config.telegram.botToken) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN is not set. The Telegram bot is disabled.');
    return null;
  }

  const bot = new Telegraf(config.telegram.botToken);

  bot.start((ctx) => ctx.reply(WELCOME));

  bot.on(
    'text',
    handleUpdate(async (ctx) => ({ userMessage: ctx.message.text }), GENERIC_ERROR)
  );

  bot.on(
    'photo',
    handleUpdate(async (ctx) => {
      const largest = ctx.message.photo[ctx.message.photo.length - 1];
      return {
        userMessage: ctx.message.caption || 'What is in this photo?',
        media: {
          data: await downloadAsBase64(ctx, largest.file_id),
          mimeType: 'image/jpeg',
        },
      };
    }, 'Sorry, I had trouble processing this image. Please try again.')
  );

  bot.on(
    'voice',
    handleUpdate(async (ctx) => ({
      userMessage: 'Listen to this voice message and respond accordingly.',
      media: {
        data: await downloadAsBase64(ctx, ctx.message.voice.file_id),
        mimeType: ctx.message.voice.mime_type || 'audio/ogg',
      },
    }), 'Sorry, I had trouble understanding this voice message. Please try again.')
  );

  bot.catch((err, ctx) => {
    console.error(`❌ [Telegram] Unhandled error for ${ctx?.updateType}:`, err);
  });

  return bot;
}

/**
 * Starts long polling.
 *
 * IMPORTANT: in Telegraf v4, the promise returned by launch() resolves when the
 * bot STOPS, not when it starts — which is why launch() takes an onLaunch
 * callback. The previous code awaited it, so the "bot is running" log never fired
 * and the 409-conflict retry could only ever run after the bot had already died.
 */
function launchBot(bot, { retries = 3, retryDelayMs = 5000 } = {}) {
  if (!bot) return;

  bot.launch({ dropPendingUpdates: true }, () => console.log('✅ Telegram bot is running'))
    .catch((err) => {
      const isConflict = err?.response?.error_code === 409;
      if (isConflict && retries > 0) {
        console.warn(`⚠️  Telegram 409 Conflict. Retrying in ${retryDelayMs / 1000}s (${retries} left)...`);
        setTimeout(() => launchBot(bot, { retries: retries - 1, retryDelayMs }), retryDelayMs).unref();
      } else {
        console.error('❌ Telegram bot stopped:', err);
      }
    });
}

module.exports = { createBot, launchBot, splitMessage, stripMarkdown };
