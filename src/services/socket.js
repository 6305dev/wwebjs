const logger = require("../utils/logger");

/**
 * Sets up Socket.IO events for live connection & QR streaming
 */
function setupSocket(io, getState) {
  io.on("connection", (socket) => {
    logger.info("socket", `Client connected: ${socket.id}`);

    const state = getState();

    socket.emit("status", { status: state.currentStatus });
    if (state.lastQrDataUrl) {
      socket.emit("status", { status: "qr", qr: state.lastQrDataUrl });
    }

    socket.on("disconnect", () => {
      logger.info("socket", `Client disconnected: ${socket.id}`);
    });
  });
}

module.exports = { setupSocket };
