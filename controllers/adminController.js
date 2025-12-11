const User = require('../models/users');
const Session = require('../models/session');
const AuditLog = require('../models/auditLog');
const RateLimitLog = require('../models/rateLimitLog');

const AdminController = {
  // Get all users (admin only)
  getAllUsers: async (req, res) => {
    try {
      const { page = 1, limit = 20, role, search, isActive, isBanned } = req.query;
      
      const result = await User.getAllUsers(parseInt(page), parseInt(limit), {
        role,
        search,
        isActive: isActive !== undefined ? isActive === 'true' : undefined,
        isBanned: isBanned !== undefined ? isBanned === 'true' : undefined
      });
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get All Users Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Get user by ID (admin only)
  getUserById: async (req, res) => {
    try {
      const { userId } = req.params;
      
      const user = await User.getUserById(parseInt(userId));
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      res.json({
        success: true,
        data: user
      });
      
    } catch (error) {
      console.error('❌ Get User By ID Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Update user (admin only)
  updateUser: async (req, res) => {
    try {
      const { userId } = req.params;
      const updateData = req.body;
      const adminId = req.user.userId;
      
      // Check if user exists
      const user = await User.getUserById(parseInt(userId));
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      // Handle different update types
      let result;
      
      if (updateData.role !== undefined) {
        result = await User.changeUserRole(
          parseInt(userId),
          updateData.role,
          adminId,
          req.ip,
          req.get('User-Agent')
        );
      } else if (updateData.isBanned !== undefined) {
        if (updateData.isBanned) {
          result = await User.banUser(
            parseInt(userId),
            updateData.reason,
            adminId,
            req.ip,
            req.get('User-Agent')
          );
        } else {
          result = await User.unbanUser(
            parseInt(userId),
            adminId,
            req.ip,
            req.get('User-Agent')
          );
        }
      } else if (updateData.isActive !== undefined) {
        if (updateData.isActive) {
          result = await User.reactivateUser(
            parseInt(userId),
            adminId,
            req.ip,
            req.get('User-Agent')
          );
        } else {
          result = await User.deactivateUser(
            parseInt(userId),
            adminId,
            req.ip,
            req.get('User-Agent')
          );
        }
      } else {
        return res.status(400).json({
          success: false,
          error: 'Invalid update operation'
        });
      }
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      // Get updated user
      const updatedUser = await User.getUserById(parseInt(userId));
      
      res.json({
        success: true,
        message: 'User updated successfully',
        data: updatedUser
      });
      
    } catch (error) {
      console.error('❌ Update User Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Reset user password (admin only)
  resetUserPassword: async (req, res) => {
    try {
      const { userId } = req.params;
      const { newPassword } = req.body;
      const adminId = req.user.userId;
      
      if (!newPassword || newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 8 characters long'
        });
      }
      
      const result = await User.resetPassword(
        parseInt(userId),
        newPassword,
        adminId,
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Password reset successfully'
      });
      
    } catch (error) {
      console.error('❌ Reset User Password Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Get audit logs (admin only)
  getAuditLogs: async (req, res) => {
    try {
      const {
        page = 1,
        limit = 50,
        userId,
        action,
        entityType,
        entityId,
        startDate,
        endDate,
        ipAddress
      } = req.query;
      
      const filters = {};
      
      if (userId) filters.userId = parseInt(userId);
      if (action) filters.action = action;
      if (entityType) filters.entityType = entityType;
      if (entityId) filters.entityId = parseInt(entityId);
      if (startDate) filters.startDate = new Date(startDate);
      if (endDate) filters.endDate = new Date(endDate);
      if (ipAddress) filters.ipAddress = ipAddress;
      
      const result = await AuditLog.getAuditLogs(
        filters,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get Audit Logs Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Get rate limit analytics (admin only)
  getRateLimitAnalytics: async (req, res) => {
    try {
      const { startDate, endDate, groupBy = 'hour' } = req.query;
      
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          error: 'Start date and end date are required'
        });
      }
      
      const analytics = await RateLimitLog.getAnalytics(
        new Date(startDate),
        new Date(endDate),
        groupBy
      );
      
      res.json({
        success: true,
        data: analytics
      });
      
    } catch (error) {
      console.error('❌ Get Rate Limit Analytics Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Get user sessions (admin only)
  getUserSessionsAdmin: async (req, res) => {
    try {
      const { userId } = req.params;
      
      const sessions = await Session.getUserSessions(parseInt(userId));
      
      res.json({
        success: true,
        data: sessions
      });
      
    } catch (error) {
      console.error('❌ Get User Sessions Admin Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Revoke user session (admin only)
  revokeUserSessionAdmin: async (req, res) => {
    try {
      const { userId, sessionId } = req.params;
      const adminId = req.user.userId;
      
      const result = await Session.revokeSession(
        sessionId,
        adminId,
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Session revoked successfully'
      });
      
    } catch (error) {
      console.error('❌ Revoke User Session Admin Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Revoke all user sessions (admin only)
  revokeAllUserSessionsAdmin: async (req, res) => {
    try {
      const { userId } = req.params;
      const adminId = req.user.userId;
      
      const result = await Session.revokeAllUserSessions(
        parseInt(userId),
        null,
        adminId,
        req.ip,
        req.get('User-Agent')
      );
      
      res.json({
        success: true,
        message: `Revoked ${result.revokedCount} sessions`,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Revoke All User Sessions Admin Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Search users (admin only)
  searchUsersAdmin: async (req, res) => {
    try {
      const { query, limit = 20 } = req.query;
      
      if (!query) {
        return res.status(400).json({
          success: false,
          error: 'Search query is required'
        });
      }
      
      const users = await User.searchUsers(query, parseInt(limit));
      
      res.json({
        success: true,
        data: users
      });
      
    } catch (error) {
      console.error('❌ Search Users Admin Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Get user statistics (admin only)
  getUserStatsAdmin: async (req, res) => {
    try {
      const { userId } = req.params;
      
      const stats = await User.getUserStats(parseInt(userId));
      
      res.json({
        success: true,
        data: stats
      });
      
    } catch (error) {
      console.error('❌ Get User Stats Admin Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Cleanup expired sessions (admin only)
  cleanupExpiredSessions: async (req, res) => {
    try {
      const result = await Session.cleanupExpiredSessions();
      
      res.json({
        success: true,
        message: `Cleaned up ${result.deletedCount} expired sessions`,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Cleanup Expired Sessions Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Cleanup old audit logs (admin only)
  cleanupOldAuditLogs: async (req, res) => {
    try {
      const { days = 90 } = req.query;
      
      const result = await AuditLog.cleanupOldLogs(parseInt(days));
      
      res.json({
        success: true,
        message: `Cleaned up ${result.deletedCount} old audit logs`,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Cleanup Old Audit Logs Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Cleanup old rate limit logs (admin only)
  cleanupOldRateLimitLogs: async (req, res) => {
    try {
      const { days = 30 } = req.query;
      
      const result = await RateLimitLog.cleanupOldLogs(parseInt(days));
      
      res.json({
        success: true,
        message: `Cleaned up ${result.deletedCount} old rate limit logs`,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Cleanup Old Rate Limit Logs Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
};

module.exports = AdminController;