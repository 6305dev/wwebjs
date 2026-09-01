const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const config = require("./config");
const { initDatabase } = require("./database");
const { createWhatsAppClient } = require("./services/whatsapp");
const { setupSocket } = require("./services/socket");
const { messageQueue } = require("./services/queue");
const { createMainRouter } = require("./routes");
const { errorHandler } = require("./middlewares/errorHandler");
const logger = require("./utils/logger");

function createApp() {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  // Global Middlewares
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Initialize WhatsApp Client and Services
  const { waClient, state, restartClient, logoutClient } = createWhatsAppClient(io);

  // Setup Socket.IO Events
  setupSocket(io, () => state);

  // Setup Routes
  const router = createMainRouter({
    getWaClient: () => waClient,
    state,
    io,
    restartClient,
    logoutClient,
    config,
  });

  app.use("/", router);

  // Global Error Handler Middleware
  app.use(errorHandler);

  return {
    app,
    server,
    io,
    waClient,
    state,
    config,
    initDatabase,
    messageQueue,
  };
}

module.exports = { createApp };
