const connectToDB = require("../config/db");
const sql = require("mssql");

const AuditLog = {
  // Create audit log entry
  createLog: async (logData) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, logData.userId || null)
        .input("Action", sql.VarChar(100), logData.action)
        .input("EntityType", sql.VarChar(50), logData.entityType)
        .input("EntityId", sql.Int, logData.entityId || null)
        .input("OldValues", sql.NVarChar(sql.MAX), logData.oldValues || null)
        .input("NewValues", sql.NVarChar(sql.MAX), logData.newValues || null)
        .input("IpAddress", sql.VarChar(45), logData.ipAddress || null)
        .input("UserAgent", sql.VarChar(500), logData.userAgent || null)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, OldValues, NewValues, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @OldValues, @NewValues, @IpAddress, @UserAgent)
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Create Audit Log Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get audit logs with filters
  getAuditLogs: async (filters = {}, page = 1, limit = 50) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      let whereClause = "WHERE 1=1";
      const request = pool.request();
      
      if (filters.userId) {
        whereClause += " AND UserId = @UserId";
        request.input("UserId", sql.Int, filters.userId);
      }
      
      if (filters.action) {
        whereClause += " AND Action = @Action";
        request.input("Action", sql.VarChar(100), filters.action);
      }
      
      if (filters.entityType) {
        whereClause += " AND EntityType = @EntityType";
        request.input("EntityType", sql.VarChar(50), filters.entityType);
      }
      
      if (filters.entityId) {
        whereClause += " AND EntityId = @EntityId";
        request.input("EntityId", sql.Int, filters.entityId);
      }
      
      if (filters.startDate) {
        whereClause += " AND CreatedAt >= @StartDate";
        request.input("StartDate", sql.DateTime, filters.startDate);
      }
      
      if (filters.endDate) {
        whereClause += " AND CreatedAt <= @EndDate";
        request.input("EndDate", sql.DateTime, filters.endDate);
      }
      
      if (filters.ipAddress) {
        whereClause += " AND IpAddress = @IpAddress";
        request.input("IpAddress", sql.VarChar(45), filters.ipAddress);
      }

      const result = await request.query(`
        SELECT 
          al.*,
          u.Username,
          u.FullName,
          u.Email
        FROM AuditLogs al
        LEFT JOIN Users u ON al.UserId = u.UserId
        ${whereClause}
        ORDER BY al.CreatedAt DESC
        OFFSET ${offset} ROWS
        FETCH NEXT ${limit} ROWS ONLY;
      `);
      
      // Get total count
      const countResult = await pool.request().query(`
        SELECT COUNT(*) as total FROM AuditLogs al ${whereClause}
      `);
      
      return {
        logs: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get Audit Logs Error:", error);
      return { logs: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Clean up old audit logs
  cleanupOldLogs: async (daysToKeep = 90) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("CutoffDate", sql.DateTime, new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000))
        .query(`
          DELETE FROM AuditLogs
          WHERE CreatedAt <= @CutoffDate
        `);
      
      return { 
        success: true,
        deletedCount: result.rowsAffected[0]
      };
    } catch (error) {
      console.error("❌ Cleanup Old Audit Logs Error:", error);
      return { success: false, error: error.message };
    }
  }
};

module.exports = AuditLog;