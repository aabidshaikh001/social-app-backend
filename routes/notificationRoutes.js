const express = require('express');
const router = express.Router();
const NotificationController = require('../controllers/notificationController');
const { authenticate, authorize, rateLimiter } = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(authenticate);

// Rate limiting for notification endpoints
const notificationRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 60, // 60 requests per 15 minutes
  message: 'Too many notification requests. Please try again later.'
});

// Get notifications
router.get('/',
  notificationRateLimiter,
  NotificationController.getNotifications
);

// Get unread notifications count
router.get('/unread/count',
  notificationRateLimiter,
  NotificationController.getUnreadCount
);

// Get notification by ID
router.get('/:notificationId',
  notificationRateLimiter,
  NotificationController.getNotificationById
);

// Mark notification as read
router.put('/:notificationId/read',
  notificationRateLimiter,
  NotificationController.markAsRead
);

// Mark all notifications as read
router.put('/read/all',
  notificationRateLimiter,
  NotificationController.markAllAsRead
);

// Delete notification
router.delete('/:notificationId',
  notificationRateLimiter,
  NotificationController.deleteNotification
);

// Clear all notifications
router.delete('/',
  notificationRateLimiter,
  NotificationController.clearAllNotifications
);

// Get notifications by type
router.get('/type/:type',
  notificationRateLimiter,
  NotificationController.getNotificationsByType
);

// Admin routes for notification management
router.use('/admin', authorize('admin', 'superadmin'));

// Create notification (admin only)
router.post('/admin/create',
  rateLimiter({ maxRequests: 30 }),
  NotificationController.createNotification
);

// Get user notifications (admin view)
router.get('/admin/user/:userId',
  rateLimiter({ maxRequests: 30 }),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 50 } = req.query;
      
      // Use the model directly for admin access
      const Notification = require('../models/Notification');
      const result = await Notification.getUserNotifications(
        parseInt(userId),
        parseInt(page),
        parseInt(limit),
        false
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Admin Get User Notifications Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user notifications'
      });
    }
  }
);

// Delete user notifications (admin)
router.delete('/admin/user/:userId',
  rateLimiter({ maxRequests: 20 }),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const Notification = require('../models/Notification');
      
      const result = await Notification.clearAllNotifications(parseInt(userId));
      
      if (!result.success) {
        return res.status(500).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'All user notifications cleared'
      });
      
    } catch (error) {
      console.error('❌ Admin Clear User Notifications Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to clear user notifications'
      });
    }
  }
);

module.exports = router;