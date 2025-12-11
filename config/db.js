const sql = require("mssql"); // const mssql library
const dotenv = require("dotenv"); // const dotenv library

// Load environment variables = require(.env file
dotenv.config();

const config = {
  user: process.env.USER,              // Username = require(.env
  password: process.env.PASSWORD,      // Password = require(.env
  server: process.env.SERVER.split(",")[0], // Server address = require(.env (without the port)
  port: parseInt(process.env.SERVER.split(",")[1]), // Extract port = require(.env
  database: process.env.DATABASE,      // Database name = require(.env
  options: {
    encrypt: true,                     // Use true for Azure or if required
    trustServerCertificate: true       // Disable SSL verification (use cautiously)
  }
};

let pool;

const connectToDB = async () => {
  if (!pool) {
    try {
      pool = await sql.connect(config);
      console.log("Connected to the database");
    } catch (error) {
      console.error("Database connection failed:", error);
      throw error;
    }
  }
  return pool;
};

module.exports = connectToDB;
