const connectToDB = require("../config/db");
const sql = require("mssql");
const crypto = require("crypto");

const Session = {
  // Create a new session
  createSession: async (userId, deviceInfo = null, ipAddress = null, userAgent = null, expiresInHours = 24) => {
    try {
      const pool = await connectToDB();
      
      const sessionId = crypto.randomBytes(64).toString('hex');
      const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
      
      await pool.request()
        .input("SessionId", sql.VarChar(500), sessionId)
        .input("UserId", sql.Int, userId)
        .input("DeviceInfo", sql.VarChar(500), deviceInfo)
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .input("ExpiresAt", sql.DateTime, expiresAt)
        .query(`
          INSERT INTO Sessions (SessionId, UserId, DeviceInfo, IpAddress, UserAgent, ExpiresAt)
          VALUES (@SessionId, @UserId, @DeviceInfo, @IpAddress, @UserAgent, @ExpiresAt)
        `);
      
      return { 
        success: true, 
        sessionId,
        expiresAt 
      };
    } catch (error) {
      console.error("❌ Create Session Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get session by ID
  getSessionById: async (sessionId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("SessionId", sql.VarChar(500), sessionId)
        .query(`
          SELECT s.*, u.Username, u.Email, u.Role, u.IsActive, u.IsBanned
          FROM Sessions s
          JOIN Users u ON s.UserId = u.UserId
          WHERE s.SessionId = @SessionId 
            AND s.IsRevoked = 0
            AND s.ExpiresAt > GETDATE()
            AND u.DeletedAt IS NULL
        `);
      
      return result.recordset[0] || null;
    } catch (error) {
      console.error("❌ Get Session Error:", error);
      return null;
    }
  },

  // Get all active sessions for user
  getUserSessions: async (userId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT *
          FROM Sessions
          WHERE UserId = @UserId 
            AND IsRevoked = 0
            AND ExpiresAt > GETDATE()
          ORDER BY CreatedAt DESC
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Get User Sessions Error:", error);
      return [];
    }
  },

  // Revoke session
  revokeSession: async (sessionId, revokedBy = null, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("SessionId", sql.VarChar(500), sessionId)
        .query(`
          UPDATE Sessions
          SET IsRevoked = 1,
              LastActivityAt = GETDATE()
          WHERE SessionId = @SessionId
        `);
      
      if (result.rowsAffected[0] === 0) {
        return { success: false, error: "Session not found" };
      }
      
      // Create audit log
      if (revokedBy) {
        await pool.request()
          .input("UserId", sql.Int, revokedBy)
          .input("Action", sql.VarChar(100), "SESSION_REVOKED")
          .input("EntityType", sql.VarChar(50), "Session")
          .input("IpAddress", sql.VarChar(45), ipAddress)
          .input("UserAgent", sql.VarChar(500), userAgent)
          .query(`
            INSERT INTO AuditLogs (UserId, Action, EntityType, IpAddress, UserAgent)
            VALUES (@UserId, @Action, @EntityType, @IpAddress, @UserAgent);
          `);
      }
      
      return { success: true };
    } catch (error) {
      console.error("❌ Revoke Session Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Revoke all sessions for user (except current)
  revokeAllUserSessions: async (userId, exceptSessionId = null, revokedBy = null, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      let query = `
        UPDATE Sessions
        SET IsRevoked = 1,
            LastActivityAt = GETDATE()
        WHERE UserId = @UserId
          AND IsRevoked = 0
          AND ExpiresAt > GETDATE()
      `;
      
      const request = pool.request()
        .input("UserId", sql.Int, userId);
      
      if (exceptSessionId) {
        query += " AND SessionId != @ExceptSessionId";
        request.input("ExceptSessionId", sql.VarChar(500), exceptSessionId);
      }
      
      const result = await request.query(query);
      
      // Create audit log
      if (revokedBy) {
        await pool.request()
          .input("UserId", sql.Int, revokedBy)
          .input("Action", sql.VarChar(100), "ALL_SESSIONS_REVOKED")
          .input("EntityType", sql.VarChar(50), "User")
          .input("EntityId", sql.Int, userId)
          .input("IpAddress", sql.VarChar(45), ipAddress)
          .input("UserAgent", sql.VarChar(500), userAgent)
          .query(`
            INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
            VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
          `);
      }
      
      return { 
        success: true,
        revokedCount: result.rowsAffected[0]
      };
    } catch (error) {
      console.error("❌ Revoke All User Sessions Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Update session activity
  updateSessionActivity: async (sessionId) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("SessionId", sql.VarChar(500), sessionId)
        .query(`
          UPDATE Sessions
          SET LastActivityAt = GETDATE()
          WHERE SessionId = @SessionId
            AND IsRevoked = 0
            AND ExpiresAt > GETDATE()
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Update Session Activity Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Clean up expired sessions
  cleanupExpiredSessions: async () => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .query(`
          DELETE FROM Sessions
          WHERE ExpiresAt <= GETDATE()
             OR (IsRevoked = 1 AND LastActivityAt <= DATEADD(DAY, -7, GETDATE()))
        `);
      
      return { 
        success: true,
        deletedCount: result.rowsAffected[0]
      };
    } catch (error) {
      console.error("❌ Cleanup Expired Sessions Error:", error);
      return { success: false, error: error.message };
    }
  }
};

module.exports = Session;