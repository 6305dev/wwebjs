const { createApp } = require("./src/app");
const logger = require("./src/utils/logger");

const { server, waClient, config, initDatabase, messageQueue } = createApp();

server.listen(config.app.port, async () => {
  logger.success("server", `Gateway running on port ${config.app.port}`);
  logger.info("server", `QR Code Page: http://localhost:${config.app.port}/api/connect`);
  await initDatabase();
});

waClient.initialize().catch((err) => {
  logger.error("wa", `Initial client initialization failed: ${err.message}`);
});

process.on("uncaughtException", (err) => {
  logger.error("process", `Uncaught Exception: ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  logger.error("process", `Unhandled Rejection: ${msg}`);
});

const gracefulShutdown = async () => {
  logger.info("process", "Shutting down gracefully...");
  messageQueue.clear();

  if (waClient) {
    try {
      await waClient.destroy();
      logger.success("wa", "Client destroyed properly.");
    } catch (e) {
      logger.error("wa", `Error destroying client: ${e.message}`);
    }
  }

  process.exit(0);
};

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
