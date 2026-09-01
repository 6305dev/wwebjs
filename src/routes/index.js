const express = require("express");
const path = require("path");
const { createApiRouter } = require("./api");

/**
 * Main router initializing all sub-routes
 */
function createMainRouter(context) {
  const router = express.Router();

  // Redirect root to WhatsApp Web or configured landing page
  router.get("/", (req, res) => {
    res.redirect(301, context.config.app.mainPage);
  });

  // Serve static UI assets for /api/connect
  router.use("/api", express.static(path.join(__dirname, "../../public")));

  // API router
  router.use("/api", createApiRouter(context));

  return router;
}

module.exports = { createMainRouter };
