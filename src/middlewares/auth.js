const config = require("../config");

/**
 * Validates x-api-key header
 */
function authenticateApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];
  if (!apiKey || apiKey !== config.app.apiKey) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized: Invalid or missing API key",
    });
  }
  next();
}

module.exports = { authenticateApiKey };
