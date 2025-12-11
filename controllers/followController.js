const Follow = require('../models/follow');
const User = require('../models/users');
const Notification = require('../models/notication');

const FollowController = {
  // Follow a user
  followUser: async (req, res) => {
    try {
      const followerId = req.user.userId;
      const { userId } = req.params;
      
      if (followerId === parseInt(userId)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot follow yourself'
        });
      }
      
      // Check if target user exists
      const targetUser = await User.getUserById(parseInt(userId));
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      // Check if user is active and not banned
      if (!targetUser.IsActive || targetUser.IsBanned) {
        return res.status(400).json({
          success: false,
          error: 'Cannot follow this user'
        });
      }
      
      const result = await Follow.followUser(followerId, parseInt(userId));
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      // Create follow notification
      await Notification.createFollowNotification(followerId, parseInt(userId));
      
      res.json({
        success: true,
        message: 'Successfully followed user',
        data: {
          followingId: parseInt(userId),
          username: targetUser.Username,
          fullName: targetUser.FullName
        }
      });
      
    } catch (error) {
      console.error('❌ Follow User Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to follow user'
      });
    }
  },
  
  // Unfollow a user
  unfollowUser: async (req, res) => {
    try {
      const followerId = req.user.userId;
      const { userId } = req.params;
      
      const result = await Follow.unfollowUser(followerId, parseInt(userId));
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Successfully unfollowed user',
        data: {
          unfollowedId: parseInt(userId)
        }
      });
      
    } catch (error) {
      console.error('❌ Unfollow User Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to unfollow user'
      });
    }
  },
  
  // Check if following a user
  checkFollowing: async (req, res) => {
    try {
      const followerId = req.user.userId;
      const { userId } = req.params;
      
      const isFollowing = await Follow.isFollowing(followerId, parseInt(userId));
      
      res.json({
        success: true,
        data: {
          isFollowing,
          followerId,
          followingId: parseInt(userId)
        }
      });
      
    } catch (error) {
      console.error('❌ Check Following Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to check following status'
      });
    }
  },
  
  // Get followers list
  getFollowers: async (req, res) => {
    try {
      const userId = req.user?.userId;
      const { targetUserId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      
      // Use targetUserId if provided, otherwise use current user
      const targetId = targetUserId ? parseInt(targetUserId) : userId;
      
      if (!targetId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      const result = await Follow.getFollowers(
        targetId,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get Followers Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get followers'
      });
    }
  },
  
  // Get following list
  getFollowing: async (req, res) => {
    try {
      const userId = req.user?.userId;
      const { targetUserId } = req.params;
      const { page = 1, limit = 20 } = req.query;
      
      // Use targetUserId if provided, otherwise use current user
      const targetId = targetUserId ? parseInt(targetUserId) : userId;
      
      if (!targetId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }
      
      const result = await Follow.getFollowing(
        targetId,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get Following Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get following list'
      });
    }
  },
  
  // Get follow suggestions
  getFollowSuggestions: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { limit = 10 } = req.query;
      
      const suggestions = await Follow.getFollowSuggestions(
        userId,
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: suggestions
      });
      
    } catch (error) {
      console.error('❌ Get Follow Suggestions Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get follow suggestions'
      });
    }
  },
  
  // Get follower count
  getFollowerCount: async (req, res) => {
    try {
      const { userId } = req.params;
      
      const count = await Follow.getFollowerCount(parseInt(userId));
      
      res.json({
        success: true,
        data: {
          userId: parseInt(userId),
          followerCount: count
        }
      });
      
    } catch (error) {
      console.error('❌ Get Follower Count Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get follower count'
      });
    }
  },
  
  // Get following count
  getFollowingCount: async (req, res) => {
    try {
      const { userId } = req.params;
      
      const count = await Follow.getFollowingCount(parseInt(userId));
      
      res.json({
        success: true,
        data: {
          userId: parseInt(userId),
          followingCount: count
        }
      });
      
    } catch (error) {
      console.error('❌ Get Following Count Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get following count'
      });
    }
  },
  
  // Get mutual followers
  getMutualFollowers: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { targetUserId } = req.params;
      
      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          error: 'Target user ID is required'
        });
      }
      
      const mutualFollowers = await Follow.getMutualFollowers(
        userId,
        parseInt(targetUserId)
      );
      
      res.json({
        success: true,
        data: mutualFollowers
      });
      
    } catch (error) {
      console.error('❌ Get Mutual Followers Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get mutual followers'
      });
    }
  },
  
  // Get follow stats for current user
  getFollowStats: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const [followerCount, followingCount] = await Promise.all([
        Follow.getFollowerCount(userId),
        Follow.getFollowingCount(userId)
      ]);
      
      // Get recent followers (last 5)
      const recentFollowers = await Follow.getFollowers(userId, 1, 5);
      
      res.json({
        success: true,
        data: {
          followerCount,
          followingCount,
          recentFollowers: recentFollowers.followers
        }
      });
      
    } catch (error) {
      console.error('❌ Get Follow Stats Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get follow stats'
      });
    }
  },
  
  // Bulk follow/unfollow users
  bulkFollowAction: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { userIds, action } = req.body;
      
      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'User IDs array is required'
        });
      }
      
      if (!action || !['follow', 'unfollow'].includes(action)) {
        return res.status(400).json({
          success: false,
          error: 'Action must be "follow" or "unfollow"'
        });
      }
      
      const results = [];
      const errors = [];
      
      for (const targetUserId of userIds) {
        try {
          if (action === 'follow') {
            const result = await Follow.followUser(userId, parseInt(targetUserId));
            if (result.success) {
              results.push({ userId: targetUserId, success: true });
              // Create notification
              await Notification.createFollowNotification(userId, parseInt(targetUserId));
            } else {
              errors.push({ userId: targetUserId, error: result.error });
            }
          } else {
            const result = await Follow.unfollowUser(userId, parseInt(targetUserId));
            if (result.success) {
              results.push({ userId: targetUserId, success: true });
            } else {
              errors.push({ userId: targetUserId, error: result.error });
            }
          }
        } catch (error) {
          errors.push({ userId: targetUserId, error: error.message });
        }
      }
      
      res.json({
        success: true,
        message: `Bulk ${action} action completed`,
        data: {
          successCount: results.length,
          errorCount: errors.length,
          results,
          errors: errors.length > 0 ? errors : undefined
        }
      });
      
    } catch (error) {
      console.error('❌ Bulk Follow Action Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to perform bulk follow action'
      });
    }
  },
  
  // Search followers/following
  searchFollowersFollowing: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { query, type = 'followers', limit = 20 } = req.query;
      
      if (!query || query.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Search query is required'
        });
      }
      
      // Get all followers/following
      const result = type === 'followers' 
        ? await Follow.getFollowers(userId, 1, 1000)
        : await Follow.getFollowing(userId, 1, 1000);
      
      const list = type === 'followers' ? result.followers : result.following;
      
      // Filter by search query
      const searchTerm = query.toLowerCase();
      const filtered = list.filter(user => 
        user.Username.toLowerCase().includes(searchTerm) ||
        user.FullName.toLowerCase().includes(searchTerm)
      ).slice(0, parseInt(limit));
      
      res.json({
        success: true,
        data: {
          type,
          results: filtered,
          totalResults: filtered.length
        }
      });
      
    } catch (error) {
      console.error('❌ Search Followers/Following Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search followers/following'
      });
    }
  }
};

module.exports = FollowController;