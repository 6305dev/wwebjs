require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const path = require("path");
const cors = require("cors");
const { initDatabase, logMessage } = require("./db");

// ─── Config ────────────────────────────────────────────────────────────────────
const API_KEY = process.env.API_KEY || "your-secret-api-key-here";
const PORT = process.env.PORT || 3000;

// ─── Anti-Ban Config ───────────────────────────────────────────────────────────
const ANTI_BAN = {
  MIN_DELAY_MS: 3000, // Minimum delay antar pesan (3 detik)
  MAX_DELAY_MS: 8000, // Maximum delay antar pesan (8 detik)
  MAX_MESSAGES_PER_MINUTE: 10, // Maks pesan per menit
  MAX_UNIQUE_NUMBERS_PER_DAY: 300, // Maks nomor unik per hari
  MAX_MESSAGE_LENGTH: 4096, // Maks panjang pesan
  DUPLICATE_WINDOW_MS: 60 * 60 * 1000, // Cek duplikasi dalam 1 jam
  RECONNECT_BASE_DELAY: 5000, // Base delay reconnect (5 detik)
  RECONNECT_MAX_DELAY: 300000, // Max delay reconnect (5 menit)
};

// ─── Express + Socket.IO Setup ─────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ─── State ─────────────────────────────────────────────────────────────────────
let clientReady = false;
let currentStatus = "initializing"; // initializing | qr | authenticated | ready | disconnected
let lastQrDataUrl = null;
let reconnectAttempts = 0;

// ─── Anti-Ban: Rate Limiting & Tracking ────────────────────────────────────────
const messageTimestamps = []; // Timestamps pesan terkirim (rate limiting)
const dailyUniqueNumbers = new Set(); // Nomor unik hari ini
let dailyResetDate = new Date().toDateString();
const recentMessages = new Map(); // key: "number:messageHash" → timestamp (duplikasi)

// Message queue untuk delay antar pesan
const messageQueue = [];
let isProcessingQueue = false;

function getRandomDelay() {
  return Math.floor(
    Math.random() * (ANTI_BAN.MAX_DELAY_MS - ANTI_BAN.MIN_DELAY_MS) +
      ANTI_BAN.MIN_DELAY_MS,
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash.toString();
}

function checkRateLimit() {
  const now = Date.now();
  // Hapus timestamps yang lebih tua dari 1 menit
  while (messageTimestamps.length > 0 && now - messageTimestamps[0] > 60000) {
    messageTimestamps.shift();
  }
  return messageTimestamps.length < ANTI_BAN.MAX_MESSAGES_PER_MINUTE;
}

function checkDailyLimit(number) {
  // Reset jika hari sudah berganti
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailyUniqueNumbers.clear();
    dailyResetDate = today;
  }
  // Jika nomor sudah pernah dikirim hari ini, tidak menambah counter
  if (dailyUniqueNumbers.has(number)) return true;
  return dailyUniqueNumbers.size < ANTI_BAN.MAX_UNIQUE_NUMBERS_PER_DAY;
}

function checkDuplicate(number, message) {
  const key = `${number}:${simpleHash(message)}`;
  const lastSent = recentMessages.get(key);
  if (lastSent && Date.now() - lastSent < ANTI_BAN.DUPLICATE_WINDOW_MS) {
    return true; // Is duplicate
  }
  return false;
}

function recordMessage(number, message) {
  const key = `${number}:${simpleHash(message)}`;
  recentMessages.set(key, Date.now());
  messageTimestamps.push(Date.now());
  dailyUniqueNumbers.add(number);

  // Cleanup old duplicate records
  const now = Date.now();
  for (const [k, v] of recentMessages.entries()) {
    if (now - v > ANTI_BAN.DUPLICATE_WINDOW_MS) {
      recentMessages.delete(k);
    }
  }
}

// ─── Message Queue Processor ───────────────────────────────────────────────────
async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (messageQueue.length > 0) {
    const task = messageQueue.shift();

    try {
      if (!clientReady) {
        task.reject(new Error("WhatsApp client tidak siap"));
        continue;
      }

      // Random delay sebelum kirim (meniru perilaku manusia)
      const delay = getRandomDelay();
      console.log(
        `[QUEUE] Waiting ${delay}ms before sending to ${task.chatId}...`,
      );
      await sleep(delay);

      const response = await waClient.sendMessage(task.chatId, task.message);
      recordMessage(task.number, task.message);
      task.resolve(response);
    } catch (error) {
      task.reject(error);
    }
  }

  isProcessingQueue = false;
}

function enqueueMessage(chatId, number, message) {
  return new Promise((resolve, reject) => {
    messageQueue.push({ chatId, number, message, resolve, reject });
    processQueue();
  });
}

// ─── WhatsApp Client ───────────────────────────────────────────────────────────
const waClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-gpu",
    ],
  },
});

function updateStatus(status, data = {}) {
  currentStatus = status;
  io.emit("status", { status, ...data });
  console.log(`[STATUS] ${status}`);
}

waClient.on("qr", async (qr) => {
  try {
    const qrDataUrl = await QRCode.toDataURL(qr, {
      width: 300,
      margin: 2,
      color: { dark: "#ffffff", light: "#00000000" },
    });
    lastQrDataUrl = qrDataUrl;
    clientReady = false;
    updateStatus("qr", { qr: qrDataUrl });
  } catch (err) {
    console.error("[QR] Error generating QR:", err);
  }
});

waClient.on("authenticated", () => {
  lastQrDataUrl = null;
  reconnectAttempts = 0; // Reset reconnect counter on success
  updateStatus("authenticated");
});

waClient.on("auth_failure", (msg) => {
  clientReady = false;
  updateStatus("auth_failure", { message: msg });
  console.error("[AUTH] Authentication failure:", msg);
});

waClient.on("ready", () => {
  clientReady = true;
  lastQrDataUrl = null;
  reconnectAttempts = 0; // Reset reconnect counter on success
  updateStatus("ready");
  console.log("[WA] Client is ready!");
});

waClient.on("disconnected", (reason) => {
  clientReady = false;
  lastQrDataUrl = null;
  updateStatus("disconnected", { reason });
  console.log("[WA] Disconnected:", reason);

  // Exponential backoff reconnect (anti-ban)
  reconnectAttempts++;
  const delay = Math.min(
    ANTI_BAN.RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1),
    ANTI_BAN.RECONNECT_MAX_DELAY,
  );
  console.log(
    `[WA] Reconnecting in ${delay / 1000}s (attempt #${reconnectAttempts})...`,
  );
  setTimeout(() => {
    console.log("[WA] Reinitializing...");
    updateStatus("initializing");
    waClient.initialize();
  }, delay);
});

// ─── Socket.IO ─────────────────────────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log("[SOCKET] Client connected:", socket.id);
  // Send current state to newly connected client
  socket.emit("status", { status: currentStatus });
  if (lastQrDataUrl) {
    socket.emit("status", { status: "qr", qr: lastQrDataUrl });
  }
});

// ─── API Key Middleware ────────────────────────────────────────────────────────
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== API_KEY) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or missing API key",
    });
  }
  next();
}

// ─── REST API ──────────────────────────────────────────────────────────────────

// Health / status check
app.get("/api/status", (req, res) => {
  res.json({
    success: true,
    status: currentStatus,
    ready: clientReady,
    queueLength: messageQueue.length,
    dailyUniqueCount: dailyUniqueNumbers.size,
    dailyLimit: ANTI_BAN.MAX_UNIQUE_NUMBERS_PER_DAY,
  });
});

// Send message (with anti-ban protections)
app.post("/api/send-message", authenticateApiKey, async (req, res) => {
  try {
    const { number, message, referal } = req.body;

    // ─── Validasi Input ──────────────────────────────────────────
    if (!number || !message) {
      return res.status(400).json({
        success: false,
        message: 'Parameter "number" dan "message" wajib diisi',
      });
    }

    // Validasi panjang pesan
    if (message.length > ANTI_BAN.MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Pesan terlalu panjang. Maksimal ${ANTI_BAN.MAX_MESSAGE_LENGTH} karakter.`,
      });
    }

    if (!clientReady) {
      return res.status(503).json({
        success: false,
        message:
          "WhatsApp client belum siap. Silakan scan QR code terlebih dahulu.",
      });
    }

    // ─── Format Nomor ────────────────────────────────────────────
    let formattedNumber = number.replace(/\D/g, "");
    if (formattedNumber.startsWith("0")) {
      formattedNumber = "62" + formattedNumber.slice(1);
    }
    const chatId = formattedNumber.includes("@c.us")
      ? formattedNumber
      : `${formattedNumber}@c.us`;

    // ─── Anti-Ban Checks ─────────────────────────────────────────

    // 1. Rate limit check
    if (!checkRateLimit()) {
      return res.status(429).json({
        success: false,
        message: `Terlalu banyak pesan. Maksimal ${ANTI_BAN.MAX_MESSAGES_PER_MINUTE} pesan/menit. Coba lagi nanti.`,
      });
    }

    // 2. Daily limit check
    if (!checkDailyLimit(formattedNumber)) {
      return res.status(429).json({
        success: false,
        message: `Batas harian tercapai. Maksimal ${ANTI_BAN.MAX_UNIQUE_NUMBERS_PER_DAY} nomor unik/hari.`,
      });
    }

    // 3. Duplicate check
    if (checkDuplicate(formattedNumber, message)) {
      return res.status(409).json({
        success: false,
        message:
          "Pesan yang sama sudah dikirim ke nomor ini dalam 1 jam terakhir.",
      });
    }

    // 4. Cek apakah nomor terdaftar di WhatsApp
    try {
      const isRegistered = await waClient.isRegisteredUser(chatId);
      if (!isRegistered) {
        return res.status(400).json({
          success: false,
          message: "Nomor tidak terdaftar di WhatsApp.",
        });
      }
    } catch (checkErr) {
      console.warn(
        "[WA] Could not verify number registration:",
        checkErr.message,
      );
      // Lanjutkan kirim meskipun gagal cek (jangan block sepenuhnya)
    }

    // ─── Kirim via Queue (dengan delay otomatis) ─────────────────
    const response = await enqueueMessage(chatId, formattedNumber, message);

    // Log to database
    await logMessage({
      messageId: response.id._serialized,
      sender: referal,
      number: formattedNumber,
      message,
      status: "sent",
    });

    // Emit event to web client
    io.emit("message_sent", {
      number: formattedNumber,
      message,
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      message: "Pesan berhasil dikirim",
      data: {
        id: response.id._serialized,
        number: formattedNumber,
        message,
        timestamp: response.timestamp,
      },
    });
  } catch (error) {
    console.error("[API] Send message error:", error);

    // Log failed message to database
    try {
      await logMessage({
        messageId: null,
        sender: req.body.referal || null,
        number: req.body.number || "",
        message: req.body.message || "",
        status: "failed",
        errorMessage: error.message,
      });
    } catch (logErr) {
      console.error("[DB] Failed to log error:", logErr.message);
    }

    res.status(500).json({
      success: false,
      message: "Gagal mengirim pesan",
      error: error.message,
    });
  }
});

// ─── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log(`\n🚀 WhatsApp Gateway API running on http://localhost:${PORT}`);
  console.log(`📱 Open browser to scan QR code`);
  console.log(`🛡️  Anti-ban protections ACTIVE:`);
  console.log(`   • Rate limit: ${ANTI_BAN.MAX_MESSAGES_PER_MINUTE} msg/min`);
  console.log(
    `   • Delay: ${ANTI_BAN.MIN_DELAY_MS / 1000}-${ANTI_BAN.MAX_DELAY_MS / 1000}s antar pesan`,
  );
  console.log(
    `   • Daily limit: ${ANTI_BAN.MAX_UNIQUE_NUMBERS_PER_DAY} unique numbers/day`,
  );
  await initDatabase();
});

waClient.initialize();
