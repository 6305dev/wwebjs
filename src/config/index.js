require("dotenv").config();

module.exports = {
  app: {
    port: parseInt(process.env.PORT || "3000", 10),
    mainPage: process.env.APP_MAINPAGE || "https://web.whatsapp.com",
    apiKey: process.env.API_KEY || "your-secret-api-key-here",
    env: process.env.NODE_ENV || "development",
  },
  db: {
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306", 10),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASS || "",
    name: process.env.DB_NAME || "whatsapp",
  },
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
  },
};
