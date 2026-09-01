const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const fs = require("fs");
const config = require("../config");
const logger = require("../utils/logger");

/**
 * Initializes and manages WhatsApp Client lifecycle
 */
function createWhatsAppClient(io) {
  const state = {
    clientReady: false,
    currentStatus: "initializing",
    lastQrDataUrl: null,
    isReconnecting: false,
    startedAt: new Date().toISOString(),
  };

  const puppeteerConfig = {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--no-zygote",
      "--disable-gpu",
      "--disable-extensions",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--mute-audio",
      "--disable-software-rasterizer",
      "--disable-background-networking",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-breakpad",
      "--disable-component-update",
      "--js-flags=--max-old-space-size=512",
    ],
  };

  if (config.puppeteer.executablePath) {
    puppeteerConfig.executablePath = config.puppeteer.executablePath;
    logger.info("wa", `Using custom Chrome path: ${config.puppeteer.executablePath}`);
  }

  let waClient = new Client({
    authStrategy: new LocalAuth(),
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    puppeteer: puppeteerConfig,
  });

  const _originalLogout = waClient.authStrategy.logout.bind(waClient.authStrategy);
  waClient.authStrategy.logout = async function () {
    try {
      if (waClient.pupBrowser && waClient.pupBrowser.isConnected()) {
        await waClient.pupBrowser.close();
        logger.info("auth", "Browser closed to release file locks.");
      }
    } catch (e) {
      logger.warn("auth", `Browser close warning: ${e.message}`);
    }

    await new Promise((r) => setTimeout(r, 1500));

    try {
      await _originalLogout();
      logger.info("auth", "Session directory cleared.");
    } catch (e) {
      logger.warn("auth", `Standard logout failed, forcing session removal: ${e.message}`);
      const sessionDir = waClient.authStrategy.userDataDir;
      if (sessionDir) {
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          logger.info("auth", "Session directory force-removed.");
        } catch (err) {
          logger.warn("auth", `Could not remove session dir (non-fatal): ${err.message}`);
        }
      }
    }
  };

  function updateStatus(status, data = {}) {
    state.currentStatus = status;
    io.emit("status", { status, ...data });
    logger.info("status", status);
  }

  function bindClientEvents(client) {
    client.on("qr", async (qr) => {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, {
          width: 300,
          margin: 2,
          color: { dark: "#010101ff", light: "#FFFFFF" },
        });
        state.lastQrDataUrl = qrDataUrl;
        state.clientReady = false;
        updateStatus("qr", { qr: qrDataUrl });
      } catch (err) {
        logger.error("qr", "Error generating QR:", err.message);
      }
    });

    client.on("authenticated", () => {
      state.lastQrDataUrl = null;
      updateStatus("authenticated");
    });

    client.on("auth_failure", (msg) => {
      state.clientReady = false;
      updateStatus("auth_failure", { message: msg });
      logger.error("auth", `Authentication failure: ${msg}`);
    });

    client.on("ready", () => {
      state.clientReady = true;
      state.lastQrDataUrl = null;
      state.isReconnecting = false;
      updateStatus("ready");
      logger.success("wa", "Client is ready!");
    });

    client.on("disconnected", async (reason) => {
      state.clientReady = false;
      state.lastQrDataUrl = null;
      updateStatus("disconnected", { reason });
      logger.warn("wa", `Disconnected: ${reason}`);

      if (state.isReconnecting) return;
      state.isReconnecting = true;

      if (reason === "LOGOUT") {
        logger.info("wa", "Logout detected. Cleaning up and reinitializing...");
        updateStatus("reconnecting");
        setTimeout(async () => {
          try {
            updateStatus("initializing");
            await client.initialize();
          } catch (err) {
            logger.error("wa", `Reinitialization after logout failed: ${err.message}`);
          } finally {
            state.isReconnecting = false;
          }
        }, 3000);
        return;
      }

      logger.info("wa", "Connection lost. Attempting to reconnect in 5 seconds...");
      setTimeout(async () => {
        try {
          updateStatus("initializing");
          await client.destroy().catch(() => {});
          await client.initialize();
        } catch (err) {
          logger.error("wa", `Reinitialization failed: ${err.message}`);
        } finally {
          state.isReconnecting = false;
        }
      }, 5000);
    });
  }

  bindClientEvents(waClient);

  async function restartClient() {
    state.clientReady = false;
    state.lastQrDataUrl = null;
    updateStatus("reconnecting");
    try {
      await waClient.destroy().catch(() => {});
      await waClient.initialize();
      return { success: true, message: "WhatsApp client restart initiated" };
    } catch (err) {
      logger.error("wa", `Restart error: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  async function logoutClient() {
    try {
      await waClient.logout();
      return { success: true, message: "WhatsApp client logged out successfully" };
    } catch (err) {
      logger.error("wa", `Logout error: ${err.message}`);
      return { success: false, message: err.message };
    }
  }

  return {
    get waClient() {
      return waClient;
    },
    state,
    restartClient,
    logoutClient,
  };
}

module.exports = { createWhatsAppClient };
