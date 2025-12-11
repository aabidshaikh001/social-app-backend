const connectToDB = require("../config/db");
const sql = require("mssql");

const RateLimitLog = {
  // Log rate limit request
  logRequest: async (logData) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, logData.userId || null)
        .input("IpAddress", sql.VarChar(45), logData.ipAddress)
        .input("UserAgent", sql.VarChar(500), logData.userAgent || null)
        .input("Endpoint", sql.VarChar(200), logData.endpoint)
        .input("Method", sql.VarChar(10), logData.method)
        .input("StatusCode", sql.Int, logData.statusCode || null)
        .input("RequestSize", sql.Int, logData.requestSize || null)
        .input("ResponseTime", sql.Int, logData.responseTime || null)
        .query(`
          INSERT INTO RateLimitLogs (UserId, IpAddress, UserAgent, Endpoint, Method, StatusCode, RequestSize, ResponseTime)
          VALUES (@UserId, @IpAddress, @UserAgent, @Endpoint, @Method, @StatusCode, @RequestSize, @ResponseTime)
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Log Rate Limit Request Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get request count for IP/User in time window
  getRequestCount: async (ipAddress, userId = null, endpoint = null, timeWindowMinutes = 15) => {
    try {
      const pool = await connectToDB();
      
      let whereClause = "WHERE RequestAt >= DATEADD(MINUTE, -@TimeWindow, GETDATE())";
      const request = pool.request()
        .input("TimeWindow", sql.Int, timeWindowMinutes);
      
      if (ipAddress) {
        whereClause += " AND IpAddress = @IpAddress";
        request.input("IpAddress", sql.VarChar(45), ipAddress);
      }
      
      if (userId) {
        whereClause += " AND UserId = @UserId";
        request.input("UserId", sql.Int, userId);
      }
      
      if (endpoint) {
        whereClause += " AND Endpoint = @Endpoint";
        request.input("Endpoint", sql.VarChar(200), endpoint);
      }
      
      const result = await request.query(`
        SELECT COUNT(*) as requestCount
        FROM RateLimitLogs
        ${whereClause}
      `);
      
      return result.recordset[0].requestCount;
    } catch (error) {
      console.error("❌ Get Request Count Error:", error);
      return 0;
    }
  },

  // Get rate limit analytics
  getAnalytics: async (startDate, endDate, groupBy = 'hour') => {
    try {
      const pool = await connectToDB();
      
      let groupByClause = "CONVERT(DATE, RequestAt)";
      if (groupBy === 'hour') {
        groupByClause = "CONVERT(DATETIME, CONVERT(VARCHAR(13), RequestAt, 120) + ':00:00')";
      } else if (groupBy === 'day') {
        groupByClause = "CONVERT(DATE, RequestAt)";
      } else if (groupBy === 'month') {
        groupByClause = "CONVERT(VARCHAR(7), RequestAt, 120) + '-01'";
      }
      
      const result = await pool.request()
        .input("StartDate", sql.DateTime, startDate)
        .input("EndDate", sql.DateTime, endDate)
        .query(`
          SELECT 
            ${groupByClause} as TimePeriod,
            COUNT(*) as TotalRequests,
            COUNT(DISTINCT IpAddress) as UniqueIPs,
            COUNT(DISTINCT UserId) as UniqueUsers,
            AVG(ResponseTime) as AvgResponseTime,
            SUM(CASE WHEN StatusCode >= 400 THEN 1 ELSE 0 END) as ErrorCount
          FROM RateLimitLogs
          WHERE RequestAt BETWEEN @StartDate AND @EndDate
          GROUP BY ${groupByClause}
          ORDER BY TimePeriod
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Get Rate Limit Analytics Error:", error);
      return [];
    }
  },

  // Clean up old rate limit logs
  cleanupOldLogs: async (daysToKeep = 30) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("CutoffDate", sql.DateTime, new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000))
        .query(`
          DELETE FROM RateLimitLogs
          WHERE RequestAt <= @CutoffDate
        `);
      
      return { 
        success: true,
        deletedCount: result.rowsAffected[0]
      };
    } catch (error) {
      console.error("❌ Cleanup Old Rate Limit Logs Error:", error);
      return { success: false, error: error.message };
    }
  }
};

module.exports = RateLimitLog;