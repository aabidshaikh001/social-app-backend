const Notification = require('../models/notication');
const { authenticate, rateLimiter } = require('../middleware/authMiddleware');

const NotificationController = {
  // Get user notifications
  getNotifications: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { 
        page = 1, 
        limit = 20, 
        unreadOnly = false,
        type,
        startDate,
        endDate 
      } = req.query;
      
      // Build filters
      const filters = {};
      if (type) filters.type = type;
      if (startDate) filters.startDate = new Date(startDate);
      if (endDate) filters.endDate = new Date(endDate);
      
      const result = await Notification.getUserNotifications(
        userId,
        parseInt(page),
        parseInt(limit),
        unreadOnly === 'true'
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get Notifications Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get notifications'
      });
    }
  },
  
  // Get unread notifications count
  getUnreadCount: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const count = await Notification.getUnreadCount(userId);
      
      res.json({
        success: true,
        data: {
          unreadCount: count
        }
      });
      
    } catch (error) {
      console.error('❌ Get Unread Count Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get unread count'
      });
    }
  },
  
  // Mark notification as read
  markAsRead: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { notificationId } = req.params;
      
      const result = await Notification.markAsRead(
        parseInt(notificationId),
        userId
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Notification marked as read'
      });
      
    } catch (error) {
      console.error('❌ Mark Notification as Read Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark notification as read'
      });
    }
  },
  
  // Mark all notifications as read
  markAllAsRead: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const result = await Notification.markAllAsRead(userId);
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'All notifications marked as read'
      });
      
    } catch (error) {
      console.error('❌ Mark All Notifications as Read Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to mark all notifications as read'
      });
    }
  },
  
  // Delete notification
  deleteNotification: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { notificationId } = req.params;
      
      const result = await Notification.deleteNotification(
        parseInt(notificationId),
        userId
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Notification deleted successfully'
      });
      
    } catch (error) {
      console.error('❌ Delete Notification Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete notification'
      });
    }
  },
  
  // Clear all notifications
  clearAllNotifications: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const result = await Notification.clearAllNotifications(userId);
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'All notifications cleared'
      });
      
    } catch (error) {
      console.error('❌ Clear All Notifications Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear notifications'
      });
    }
  },
  
  // Create a notification (for testing or admin use)
  createNotification: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { targetUserId, type, postId, commentId, message } = req.body;
      
      if (!targetUserId || !type) {
        return res.status(400).json({
          success: false,
          error: 'Target user ID and type are required'
        });
      }
      
      // Check if user is admin or trying to notify self
      const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
      
      if (!isAdmin && targetUserId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to create notifications for other users'
        });
      }
      
      // Don't allow self-notification for regular users
      if (targetUserId === userId && !isAdmin) {
        return res.status(400).json({
          success: false,
          error: 'Cannot notify yourself'
        });
      }
      
      const notificationData = {
        userId: parseInt(targetUserId),
        actorId: userId,
        type: type,
        postId: postId ? parseInt(postId) : null,
        commentId: commentId ? parseInt(commentId) : null
      };
      
      const result = await Notification.createNotification(notificationData);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.status(201).json({
        success: true,
        message: 'Notification created successfully',
        data: {
          notificationId: result.notificationId,
          createdAt: result.createdAt
        }
      });
      
    } catch (error) {
      console.error('❌ Create Notification Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create notification'
      });
    }
  },
  
  // Get notification by ID
  getNotificationById: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { notificationId } = req.params;
      
      // Get all notifications and find the specific one
      const result = await Notification.getUserNotifications(userId, 1, 100, false);
      
      const notification = result.notifications.find(
        n => n.NotificationId === parseInt(notificationId)
      );
      
      if (!notification) {
        return res.status(404).json({
          success: false,
          error: 'Notification not found'
        });
      }
      
      // Mark as read when viewed
      await Notification.markAsRead(parseInt(notificationId), userId);
      
      res.json({
        success: true,
        data: notification
      });
      
    } catch (error) {
      console.error('❌ Get Notification by ID Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get notification'
      });
    }
  },
  
  // Get notifications by type
  getNotificationsByType: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { type } = req.params;
      const { page = 1, limit = 20 } = req.query;
      
      // Get all notifications and filter by type
      const result = await Notification.getUserNotifications(
        userId,
        parseInt(page),
        parseInt(limit),
        false
      );
      
      const filteredNotifications = result.notifications.filter(
        n => n.Type === type
      );
      
      // Get total count for this type
      const total = filteredNotifications.length;
      
      res.json({
        success: true,
        data: {
          notifications: filteredNotifications,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit))
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Get Notifications by Type Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get notifications by type'
      });
    }
  }
};

module.exports = NotificationController;