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
  updateStatus("ready");
  console.log("[WA] Client is ready!");
});

waClient.on("disconnected", (reason) => {
  clientReady = false;
  lastQrDataUrl = null;
  updateStatus("disconnected", { reason });
  console.log("[WA] Disconnected:", reason);
  // Auto-reinitialize after disconnect
  setTimeout(() => {
    console.log("[WA] Reinitializing...");
    updateStatus("initializing");
    waClient.initialize();
  }, 5000);
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
  });
});

// Send message
app.post("/api/send-message", authenticateApiKey, async (req, res) => {
  try {
    const { number, message } = req.body;

    if (!number || !message) {
      return res.status(400).json({
        success: false,
        message: 'Parameter "number" dan "message" wajib diisi',
      });
    }

    if (!clientReady) {
      return res.status(503).json({
        success: false,
        message:
          "WhatsApp client belum siap. Silakan scan QR code terlebih dahulu.",
      });
    }

    // Format number: remove non-digits, handle 08xx → 628xx
    let formattedNumber = number.replace(/\D/g, "");
    if (formattedNumber.startsWith("0")) {
      formattedNumber = "62" + formattedNumber.slice(1);
    }
    const chatId = formattedNumber.includes("@c.us")
      ? formattedNumber
      : `${formattedNumber}@c.us`;

    const response = await waClient.sendMessage(chatId, message);

    // Log to database
    await logMessage({
      messageId: response.id._serialized,
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
    await logMessage({
      messageId: null,
      number: req.body.number || "",
      message: req.body.message || "",
      status: "failed",
      errorMessage: error.message,
    });

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
  console.log(`🔑 API Key: ${API_KEY}\n`);
  await initDatabase();
});

waClient.initialize();
