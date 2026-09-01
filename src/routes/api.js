const express = require("express");
const path = require("path");
const { authenticateApiKey } = require("../middlewares/auth");
const { logMessage, getLogs } = require("../database");
const { messageQueue } = require("../services/queue");
const { normalizePhoneNumber } = require("../utils/phone");
const logger = require("../utils/logger");

function createApiRouter({ getWaClient, state, io, restartClient, logoutClient }) {
  const router = express.Router();

  // QR Web Interface
  router.get("/connect", (req, res) => {
    res.sendFile(path.join(__dirname, "../../public/index.html"));
  });

  // Client Status
  router.get("/status", (req, res) => {
    res.json({
      success: true,
      status: state.currentStatus,
      ready: state.clientReady,
      queueLength: messageQueue.length,
    });
  });

  // Health Check & Uptime Monitoring
  router.get("/health", (req, res) => {
    const memory = process.memoryUsage();
    res.json({
      success: true,
      uptimeSeconds: Math.floor(process.uptime()),
      status: state.currentStatus,
      ready: state.clientReady,
      queueLength: messageQueue.length,
      startedAt: state.startedAt || null,
      memory: {
        rssMb: Math.round((memory.rss / 1024 / 1024) * 100) / 100,
        heapUsedMb: Math.round((memory.heapUsed / 1024 / 1024) * 100) / 100,
      },
    });
  });

  // Message Logs (Paginated)
  router.get("/logs", authenticateApiKey, async (req, res, next) => {
    try {
      const { page, limit, status } = req.query;
      const result = await getLogs({ page, limit, status });
      res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  });

  // Restart WhatsApp Client Session
  router.post("/restart", authenticateApiKey, async (req, res) => {
    if (typeof restartClient !== "function") {
      return res.status(501).json({ success: false, message: "Restart function not available" });
    }
    const result = await restartClient();
    res.json(result);
  });

  // Logout WhatsApp Client Session
  router.post("/logout", authenticateApiKey, async (req, res) => {
    if (typeof logoutClient !== "function") {
      return res.status(501).json({ success: false, message: "Logout function not available" });
    }
    const result = await logoutClient();
    res.json(result);
  });

  // Send Message with Anti-Ban Queue
  router.post("/send-message", authenticateApiKey, async (req, res) => {
    const { number, message, sender } = req.body;

    if (!number || !message) {
      return res.status(400).json({
        success: false,
        message: 'Parameter "number" dan "message" wajib diisi',
      });
    }

    if (!state.clientReady) {
      return res.status(503).json({
        success: false,
        message: "WhatsApp client belum siap. Silakan scan QR code terlebih dahulu.",
      });
    }

    const formattedNumber = normalizePhoneNumber(number);
    if (!formattedNumber || formattedNumber.length < 8) {
      return res.status(400).json({
        success: false,
        message: `Format nomor ${number} tidak valid.`,
      });
    }

    try {
      const taskResult = await messageQueue.enqueue(async () => {
        const waClient = getWaClient();
        if (!waClient) {
          throw new Error("WhatsApp client instance is not initialized");
        }

        const numberId = await waClient.getNumberId(formattedNumber);
        if (!numberId) {
          const err = new Error(`Nomor ${formattedNumber} tidak terdaftar di WhatsApp.`);
          err.statusCode = 404;
          throw err;
        }

        const chatId = numberId._serialized;
        logger.info("api", `Sending message to chatId: ${chatId}`);

        const response = await waClient.sendMessage(chatId, message);
        const senderNumber = waClient.info?.wid?.user ?? sender ?? "API";
        const messageId = response?.id?._serialized ?? response?.id ?? null;

        await logMessage({
          sender: senderNumber,
          receiver: formattedNumber,
          status: "success",
        });

        io.emit("message_sent", {
          receiver: formattedNumber,
          message,
          timestamp: new Date().toISOString(),
        });

        return {
          id: messageId,
          receiver: formattedNumber,
          chatId,
          message,
          timestamp: response?.timestamp ?? null,
        };
      });

      res.json({
        success: true,
        message: "Pesan berhasil dikirim",
        data: taskResult,
      });
    } catch (error) {
      logger.error("api", `Send message error: ${error.message}`);

      try {
        const waClient = getWaClient();
        await logMessage({
          sender: waClient?.info?.wid?.user ?? req.body.sender ?? "API",
          receiver: formattedNumber || req.body.number || "",
          status: "error",
          errorMessage: error.message,
        });
      } catch (logErr) {
        logger.error("db", `Failed to log error: ${logErr.message}`);
      }

      const statusCode = error.statusCode || 500;
      res.status(statusCode).json({
        success: false,
        message: error.statusCode === 404 ? error.message : "Gagal mengirim pesan",
        error: error.message,
      });
    }
  });

  return router;
}

module.exports = { createApiRouter };
