const express = require('express');
const router = express.Router();
const AuthController = require('../controllers/authController');
const AdminController = require('../controllers/adminController');
const { authenticate, authorize, rateLimiter, requestLogger } = require('../middleware/authMiddleware');
const { upload: profileUpload } = require('../config/userprofilemulter');
const path  = require('path');

// Apply request logger to all routes
router.use(requestLogger);

// Public routes
router.post('/register', 
  rateLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 10 }), // 10 registrations per hour
  AuthController.register
);

router.post('/login', 
  rateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 5 }), // 5 login attempts per 15 minutes
  AuthController.login
);

router.post('/refresh-token', AuthController.refreshToken);

// Check availability (public)
router.get('/check-username/:username', AuthController.checkUsernameAvailability);
router.get('/check-email/:email', AuthController.checkEmailAvailability);

// Protected routes (require authentication)
router.use(authenticate);

// User profile routes
// Profile routes
router.get('/profile', authenticate, AuthController.getProfile);

// Update profile with file uploads
router.put('/update-profile', 
  authenticate,
  profileUpload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'cover', maxCount: 1 }
  ]),
  AuthController.updateProfile
);

// Upload avatar only
router.post('/profile/avatar',
  authenticate,
  profileUpload.single('avatar'),
  AuthController.uploadAvatar
);

// Upload cover only
router.post('/profile/cover',
  authenticate,
  profileUpload.single('cover'),
  AuthController.uploadCover
);

// 🔥 User suggestions route
router.get('/suggestions', authenticate, AuthController.getUserSuggestions);

// Remove avatar
router.delete('/profile/avatar', authenticate, AuthController.removeAvatar);

// Remove cover
router.delete('/profile/cover', authenticate, AuthController.removeCover);
router.put('/change-password', AuthController.changePassword);
router.put('/settings', AuthController.updateSettings);
router.post('/verify-email', AuthController.verifyEmail);

// Session management
router.get('/sessions', AuthController.getSessions);
router.post('/logout', AuthController.logout);
router.delete('/sessions/:sessionId', AuthController.revokeSession);

// Admin routes (require admin role)
router.use('/admin', authorize('admin', 'superadmin'));

// User management
router.get('/admin/users', 
  rateLimiter({ maxRequests: 30 }), // 30 requests per 15 minutes for admin endpoints
  AdminController.getAllUsers
);

router.get('/admin/users/search', AdminController.searchUsersAdmin);
router.get('/admin/users/:userId', AdminController.getUserById);
router.put('/admin/users/:userId', AdminController.updateUser);
router.put('/admin/users/:userId/reset-password', AdminController.resetUserPassword);
router.get('/admin/users/:userId/stats', AdminController.getUserStatsAdmin);

// Session management (admin)
router.get('/admin/users/:userId/sessions', AdminController.getUserSessionsAdmin);
router.delete('/admin/users/:userId/sessions/:sessionId', AdminController.revokeUserSessionAdmin);
router.delete('/admin/users/:userId/sessions', AdminController.revokeAllUserSessionsAdmin);

// Audit logs
router.get('/admin/audit-logs', AdminController.getAuditLogs);

// Rate limit analytics
router.get('/admin/rate-limit-analytics', AdminController.getRateLimitAnalytics);

// Cleanup tasks
router.post('/admin/cleanup/sessions', AdminController.cleanupExpiredSessions);
router.post('/admin/cleanup/audit-logs', AdminController.cleanupOldAuditLogs);
router.post('/admin/cleanup/rate-limit-logs', AdminController.cleanupOldRateLimitLogs);

module.exports = router;