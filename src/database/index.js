const mysql = require("mysql2/promise");
const config = require("../config");
const logger = require("../utils/logger");

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.name,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Initializes database tables & indexes if they do not exist
 */
async function initDatabase() {
  try {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sender VARCHAR(50) NOT NULL,
        receiver VARCHAR(50) NOT NULL,
        status ENUM('success', 'error', 'pending') NOT NULL DEFAULT 'success',
        error_message TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_receiver (receiver),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    logger.success("db", "Database connected & table ready with indexes");
  } catch (err) {
    logger.error("db", "Failed to initialize database:", err.message);
  }
}

/**
 * Logs an outbound message status
 */
async function logMessage({
  sender = "API",
  receiver,
  number, // backward compatibility
  status = "success",
  errorMessage = null,
}) {
  const targetReceiver = receiver || number || "";
  try {
    const [result] = await pool.execute(
      `INSERT INTO logs (sender, receiver, status, error_message) VALUES (?, ?, ?, ?)`,
      [sender, targetReceiver, status, errorMessage],
    );
    return result.insertId;
  } catch (err) {
    logger.error("db", "Failed to log message:", err.message);
    return null;
  }
}

/**
 * Retrieves paginated logs
 */
async function getLogs({ limit = 50, page = 1, status = null } = {}) {
  try {
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (parsedPage - 1) * parsedLimit;

    let query = `SELECT id, sender, receiver, status, error_message, created_at FROM logs`;
    const params = [];

    if (status) {
      query += ` WHERE status = ?`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(parsedLimit, offset);

    const [rows] = await pool.query(query, params);

    let countQuery = `SELECT COUNT(*) as total FROM logs`;
    const countParams = [];
    if (status) {
      countQuery += ` WHERE status = ?`;
      countParams.push(status);
    }
    const [totalRows] = await pool.query(countQuery, countParams);
    const total = totalRows[0]?.total || 0;

    return {
      data: rows,
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        totalPages: Math.ceil(total / parsedLimit),
      },
    };
  } catch (err) {
    logger.error("db", "Failed to get logs:", err.message);
    return { data: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 } };
  }
}

module.exports = { pool, initDatabase, logMessage, getLogs };
