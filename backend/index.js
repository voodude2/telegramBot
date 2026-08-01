const config = require('./config');
const app = require('./app');
const { initializeRAG, stopRefresh } = require('./services/ragService');
const { createBot, launchBot } = require('./bot/telegram');

// Exported for tests, which require this module without starting anything.
module.exports = app;

if (!config.isTest) {
  const bot = createBot();

  const server = app.listen(config.port, () => {
    console.log(`🚀 Express server listening on http://localhost:${config.port}`);

    // Warm the policy index in the background. Requests arriving before it
    // finishes await the same promise inside findRelevantPolicy, so a cold start
    // delays a policy answer instead of silently returning "no policy found".
    initializeRAG().catch((err) => console.error('❌ RAG initialization failed:', err.message));
  });

  launchBot(bot);

  /**
   * Graceful shutdown. The previous handler called process.exit(0) immediately,
   * killing in-flight requests on every deploy.
   */
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down...`);

    stopRefresh();
    if (bot) {
      try {
        bot.stop(signal);
      } catch (err) {
        console.warn('⚠️  Bot stop failed:', err.message);
      }
    }

    server.close(() => {
      console.log('✅ HTTP server closed. Bye.');
      process.exit(0);
    });

    // Backstop in case a connection refuses to drain.
    setTimeout(() => {
      console.warn('⚠️  Forcing exit after shutdown timeout.');
      process.exit(1);
    }, 10000).unref();
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));

  // Node terminates the process on an unhandled rejection. Log it and keep
  // serving rather than dropping every live connection over one stray promise.
  process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught exception:', err);
    shutdown('uncaughtException');
  });
}
