const express = require("express");
const dotenv = require("dotenv");
const morgan = require("morgan");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");
const connectToDB = require("./config/db");

// Debug Logger


// Load environment variables
dotenv.config()

// Initialize express app
const app = express()
const PORT = process.env.PORT || 5000


// Add CORS configuration
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware
app.use(express.json({ limit: "10mb" })) // Increase JSON payload limit
app.use(morgan("dev"))
app.use(cors(
  {
    origin: "http://localhost:3000", // Allow all origins by default
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    allowedHeaders: "Content-Type, Authorization",
    credentials: true, // Allow credentials if needed
    optionsSuccessStatus: 204, // For legacy browser support
  }

))

// Add request logging
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`)
  next()
})



// Initialize database tables
const initDB = async () => {
  try {
    await connectToDB()
    
    console.log("Database tables initialized")
  } catch (error) {
    console.error("Database initialization error:", error)
    process.exit(1)
  }
}

// Routes

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/post', require('./routes/postRoutes'));
app.use('/api/follow',require('./routes/followRoutes'));
app.use('/api/notification',require('./routes/notificationRoutes'));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/api/uploads", express.static(path.join(__dirname, "uploads")));
// Health check route
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" })
})

// Add more detailed error handling
app.use((err, req, res, next) => {
  console.error("Server error:", err)

  // Send appropriate error response
  res.status(500).json({
    message: "Something went wrong!",
    error: process.env.NODE_ENV === "development" ? err.message : "Server error",
  })
})

// Start server
const startServer = async () => {
  try {
    await initDB()

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`)
    })
  } catch (error) {
    console.error("Failed to start server:", error) 
    process.exit(1)
  }
}


startServer()

module.exports = app; // CommonJS export

