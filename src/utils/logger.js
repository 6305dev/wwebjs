/**
 * Simple formatted logger
 */
const logger = {
  info: (tag, message, ...args) => {
    console.log(`[${tag.toUpperCase()}] ${message}`, ...args);
  },
  warn: (tag, message, ...args) => {
    console.warn(`[${tag.toUpperCase()}] ⚠️ ${message}`, ...args);
  },
  error: (tag, message, ...args) => {
    console.error(`[${tag.toUpperCase()}] ❌ ${message}`, ...args);
  },
  success: (tag, message, ...args) => {
    console.log(`[${tag.toUpperCase()}] ✅ ${message}`, ...args);
  },
};

module.exports = logger;
