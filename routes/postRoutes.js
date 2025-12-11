const express = require('express');
const router = express.Router();
const PostController = require('../controllers/postController');
const { upload, MediaHelper } = require('../config/postmulter');
const { authenticate, authorize, rateLimiter } = require('../middleware/authMiddleware');

// Apply authentication middleware to all routes
// router.use(authenticate);

// Rate limiting for media uploads
const uploadRateLimiter = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 20, // 20 uploads per 15 minutes
  message: 'Too many upload requests. Please try again later.'
});

// Create new post with media
router.post('/',
  uploadRateLimiter,
  upload.fields([
    { name: 'media', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
  ]),
  PostController.createPost
);

// Upload multiple media files
router.post('/upload-multiple',
  uploadRateLimiter,
  upload.array('media', 10), // Max 10 files
  PostController.uploadMultipleMedia
);

// Update post media
router.put('/:postId/media',
  uploadRateLimiter,
  upload.fields([
    { name: 'media', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
  ]),
  PostController.updatePostMedia
);

// Get post by ID
router.get('/:postId', PostController.getPost);

// Get posts with filters
router.get('/', PostController.getPosts);

// Update post (text only)
router.put('/:postId', PostController.updatePost);

// Delete post
router.delete('/:postId', PostController.deletePost);

// Like/unlike post
router.post('/:postId/like', PostController.toggleLike);

// Get post likes
router.get('/likes/:postId', PostController.getPostLikes);

// Add comment
router.post('/comments/:postId', PostController.addComment);

// Get comments
router.get('/comments/:postId', PostController.getComments);

// Update comment
router.put('/comments/:commentId', PostController.updateComment);

// Delete comment
router.delete('/comments/:commentId', PostController.deleteComment);

// Like/unlike comment
router.post('/comments/:commentId/like', PostController.toggleCommentLike);

// Get trending hashtags
router.get('/trending/hashtags', PostController.getTrendingHashtags);

// Search hashtags
router.get('/hashtags/search', PostController.searchHashtags);

// Get posts by hashtag
router.get('/hashtags/:tag', PostController.getPostsByHashtag);

// Get user feed
router.get('/feed/user', PostController.getUserFeed);

// Get user's liked posts
router.get('/liked/user', PostController.getUserLikedPosts);

// Get post analytics
router.get('/:postId/analytics', PostController.getPostAnalytics);

// Report post
router.post('/:postId/report', PostController.reportPost);

// Share post
router.post('/:postId/share', PostController.sharePost);

// Get similar posts
router.get('/:postId/similar', PostController.getSimilarPosts);

// Admin routes
router.use('/admin', authorize('admin', 'superadmin'));

// Get all posts (admin)
router.get('/admin/posts', rateLimiter({ maxRequests: 30 }), async (req, res) => {
  try {
    const { page = 1, limit = 50, ...filters } = req.query;
    
    // Add admin-only filters if needed
    const result = await Post.getPosts(
      filters,
      null, // No viewer ID for admin
      parseInt(page),
      parseInt(limit)
    );
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('❌ Admin Get Posts Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get posts'
    });
  }
});

// Force delete post (admin)
router.delete('/admin/:postId', async (req, res) => {
  try {
    const { postId } = req.params;
    const adminId = req.user.userId;
    
    // Get post before deleting
    const post = await Post.getPostById(postId, null);
    
    if (!post) {
      return res.status(404).json({
        success: false,
        error: 'Post not found'
      });
    }
    
    // Force delete from database
    const result = await Post.deletePost(postId, adminId, true);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }
    
    // Delete media files
    if (post.MediaUrl) {
      const mediaPath = path.join(__dirname, '..', post.MediaUrl);
      MediaHelper.deleteFile(mediaPath);
    }
    
    if (post.ThumbnailUrl) {
      const thumbnailPath = path.join(__dirname, '..', post.ThumbnailUrl);
      MediaHelper.deleteFile(thumbnailPath);
    }
    
    res.json({
      success: true,
      message: 'Post permanently deleted'
    });
    
  } catch (error) {
    console.error('❌ Admin Delete Post Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete post'
    });
  }
});

// Admin comment management
router.delete('/admin/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const adminId = req.user.userId;
    
    const result = await Post.deleteComment(commentId, adminId, true);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error
      });
    }
    
    res.json({
      success: true,
      message: 'Comment deleted by admin'
    });
    
  } catch (error) {
    console.error('❌ Admin Delete Comment Error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete comment'
    });
  }
});

module.exports = router;