const logger = require("../utils/logger");

/**
 * Centralized error handler middleware
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || err.status || 500;
  logger.error("api", `[${req.method}] ${req.originalUrl} - ${err.message}`);

  res.status(statusCode).json({
    success: false,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {}),
  });
}

module.exports = { errorHandler };
