const express = require('express');
const router = express.Router();
const FollowController = require('../controllers/followController');
const { authenticate, authorize, rateLimiter } = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
router.use(authenticate);

// Rate limiting for follow endpoints
const followRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 50, // 50 follow actions per 15 minutes
  message: 'Too many follow actions. Please try again later.'
});

// Follow a user
router.post('/follow/:userId',
  followRateLimiter,
  FollowController.followUser
);

// Unfollow a user
router.delete('/unfollow/:userId',
  followRateLimiter,
  FollowController.unfollowUser
);

// Check if following a user
router.get('/:userId/following',
  rateLimiter({ maxRequests: 100 }),
  FollowController.checkFollowing
);

// Get followers list (current user if no targetUserId)
router.get('/followers/:targetUserId?',
  rateLimiter({ maxRequests: 100 }),
  FollowController.getFollowers
);

// Get following list (current user if no targetUserId)
router.get('/following/:targetUserId?',
  rateLimiter({ maxRequests: 100 }),
  FollowController.getFollowing
);

// Get follow suggestions
router.get('/suggestions',
  rateLimiter({ maxRequests: 60 }),
  FollowController.getFollowSuggestions
);

// Get follower count
router.get('/:userId/followers/count',
  rateLimiter({ maxRequests: 100 }),
  FollowController.getFollowerCount
);

// Get following count
router.get('/:userId/following/count',
  rateLimiter({ maxRequests: 100 }),
  FollowController.getFollowingCount
);

// Get mutual followers
router.get('/mutual/:targetUserId',
  rateLimiter({ maxRequests: 60 }),
  FollowController.getMutualFollowers
);

// Get follow stats for current user
router.get('/stats',
  rateLimiter({ maxRequests: 60 }),
  FollowController.getFollowStats
);

// Bulk follow/unfollow action
router.post('/bulk',
  followRateLimiter,
  FollowController.bulkFollowAction
);

// Search followers/following
router.get('/search',
  rateLimiter({ maxRequests: 60 }),
  FollowController.searchFollowersFollowing
);

// Admin routes for follow management
router.use('/admin', authorize('admin', 'superadmin'));

// Get user's followers (admin view)
router.get('/admin/:userId/followers',
  rateLimiter({ maxRequests: 30 }),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 50 } = req.query;
      
      const Follow = require('../models/follow');
      const result = await Follow.getFollowers(
        parseInt(userId),
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Admin Get Followers Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get followers'
      });
    }
  }
);

// Get user's following (admin view)
router.get('/admin/:userId/following',
  rateLimiter({ maxRequests: 30 }),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { page = 1, limit = 50 } = req.query;
      
      const Follow = require('../models/follow');
      const result = await Follow.getFollowing(
        parseInt(userId),
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Admin Get Following Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get following'
      });
    }
  }
);

// Remove follower (admin action)
router.delete('/admin/:userId/followers/:followerId',
  rateLimiter({ maxRequests: 20 }),
  async (req, res) => {
    try {
      const { userId, followerId } = req.params;
      const Follow = require('../models/follow');
      
      const result = await Follow.unfollowUser(
        parseInt(followerId),
        parseInt(userId)
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Follower removed by admin'
      });
      
    } catch (error) {
      console.error('❌ Admin Remove Follower Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove follower'
      });
    }
  }
);

// Force unfollow (admin action)
router.delete('/admin/:followerId/following/:userId',
  rateLimiter({ maxRequests: 20 }),
  async (req, res) => {
    try {
      const { followerId, userId } = req.params;
      const Follow = require('../models/follow');
      
      const result = await Follow.unfollowUser(
        parseInt(followerId),
        parseInt(userId)
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Follow relationship removed by admin'
      });
      
    } catch (error) {
      console.error('❌ Admin Force Unfollow Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to remove follow relationship'
      });
    }
  }
);

module.exports = router;