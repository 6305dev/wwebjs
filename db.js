const mysql = require("mysql2/promise");

// ─── MySQL Connection Pool ─────────────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "",
  database: process.env.DB_NAME || "whatsapp",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// ─── Initialize Table ──────────────────────────────────────────────────────────
async function initDatabase() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS message_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message_id VARCHAR(255) NULL,
        sender VARCHAR(50) NOT NULL DEFAULT 'API',
        number VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        status ENUM('sent', 'failed') NOT NULL DEFAULT 'sent',
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("[DB] Database connected & table ready");
  } catch (err) {
    console.error("[DB] Failed to initialize database:", err.message);
  }
}

// ─── Log Message ────────────────────────────────────────────────────────────────
async function logMessage({
  messageId,
  number,
  message,
  status = "sent",
  errorMessage = null,
}) {
  try {
    const [result] = await pool.execute(
      `INSERT INTO message_logs (message_id, number, message, status, error_message) VALUES (?, ?, ?, ?, ?)`,
      [messageId || null, number, message, status, errorMessage],
    );
    return result.insertId;
  } catch (err) {
    console.error("[DB] Failed to log message:", err.message);
    return null;
  }
}

module.exports = { pool, initDatabase, logMessage };
