const Post = require('../models/posts');
const User = require('../models/users');
const { MediaHelper } = require('../config/postmulter');
const MediaProcessor = require('../utils/mediaProcessor');
const path = require('path');
const fs = require('fs');

const PostController = {
  // Create new post with media
createPost: async (req, res) => {
  try {
    console.log("==============================================");
    console.log("📥 Incoming POST /api/post Request");
    console.log("➡️ req.body:", req.body);
    console.log("➡️ req.files:", req.files);

    // -------------------------------
    // 1. Validate userId
    // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;

    console.log("➡️ Extracted userId:", userId);

    if (!userId) {
      console.log("❌ Missing userId in request.");
      return res.status(400).json({
        success: false,
        error: "UserId is required"
      });
    }

    // -------------------------------
    // 2. Validate media file
    // -------------------------------
    if (!req.files || !req.files.media || req.files.media.length === 0) {
      console.log("❌ No media uploaded.");
      return res.status(400).json({
        success: false,
        error: "Media file is required"
      });
    }

    const mediaFile = req.files.media[0];
    const thumbnailFile = req.files.thumbnail ? req.files.thumbnail[0] : null;

    console.log("➡️ Uploaded mediaFile:", mediaFile);
    console.log("➡️ Uploaded thumbnailFile:", thumbnailFile);

    // -------------------------------
    // 3. Media Info
    // -------------------------------
    const mediaInfo = MediaHelper.getFileInfo(mediaFile);
    mediaInfo.mimeType = mediaFile.mimetype;
    mediaInfo.extension = mediaInfo.extension || path.extname(mediaInfo.fileName);
    mediaInfo.fileFormat = mediaInfo.extension.replace(".", "");

    console.log("📌 Parsed mediaInfo:", mediaInfo);

    // -------------------------------
    // 4. Hashtags
    // -------------------------------
    let hashtagArray = [];
    if (req.body.hashtags) {
      hashtagArray = req.body.hashtags
        .split(",")
        .map(tag => tag.trim())
        .filter(tag => tag.length > 0);
    }

    console.log("📌 Parsed hashtags:", hashtagArray);

    // -------------------------------
    // 5. Thumbnail Handling
    // -------------------------------
    let thumbnailPath = null;

    try {
      if (thumbnailFile) {
        thumbnailPath = thumbnailFile.path;
        console.log("📌 Using uploaded thumbnail:", thumbnailPath);
      } else {
        const thumbnailName = MediaHelper.generateThumbnailName(mediaInfo.fileName);
        const thumbnailDest = path.join(__dirname, "..", "uploads", "posts", "thumbnails", thumbnailName);

        console.log("📌 Auto-thumbnail destination:", thumbnailDest);

        if (mediaInfo.mediaType === "image") {
          await MediaProcessor.generateImageThumbnail(mediaInfo.filePath, thumbnailDest, 400, 400);
          console.log("📸 Image thumbnail generated.");
        }

        if (mediaInfo.mediaType === "video") {
          await MediaProcessor.generateVideoThumbnail(mediaInfo.filePath, thumbnailDest, 1);
          console.log("🎬 Video thumbnail generated.");
        }

        thumbnailPath = thumbnailDest;
      }
    } catch (thumbError) {
      console.log("⚠️ Thumbnail generation error:", thumbError);
    }

    // -------------------------------
    // 6. Generate media metadata
    // -------------------------------
    const metadata = await MediaProcessor.generateMediaMetadata(mediaInfo.filePath, mediaInfo.mediaType);

    console.log("📌 Extracted metadata:", metadata);

    // -------------------------------
    // 7. Move media file
    // -------------------------------
    const permanentMediaPath = path.join(
      __dirname,
      "..",
      "uploads",
      "posts",
      mediaInfo.mediaType === "image"
        ? "images"
        : mediaInfo.mediaType === "video"
        ? "videos"
        : mediaInfo.mediaType === "audio"
        ? "audios"
        : "documents",
      mediaInfo.fileName
    );

    console.log("📁 Moving media to:", permanentMediaPath);
    await MediaHelper.moveFile(mediaInfo.filePath, permanentMediaPath);

    // -------------------------------
    // 8. Move thumbnail file
    // -------------------------------
    let permanentThumbnailPath = null;

    if (thumbnailPath) {
      const thumbnailName = path.basename(thumbnailPath);
      permanentThumbnailPath = path.join(__dirname, "..", "uploads", "posts", "thumbnails", thumbnailName);

      console.log("📁 Moving thumbnail to:", permanentThumbnailPath);

      if (thumbnailPath !== permanentThumbnailPath) {
        await MediaHelper.moveFile(thumbnailPath, permanentThumbnailPath);
      }
    }

    // -------------------------------
    // 9. Build postData object
    // -------------------------------
    const postData = {
      userId: Number(userId),
      title: req.body.title || null,
      description: req.body.description || null,
      mediaType: mediaInfo.mediaType,
      mediaUrl: MediaHelper.generateMediaUrl(mediaInfo.fileName, mediaInfo.mediaType),
      thumbnailUrl: permanentThumbnailPath
        ? MediaHelper.generateThumbnailUrl(path.basename(permanentThumbnailPath))
        : null,

      width: metadata?.width || null,
      height: metadata?.height || null,
      duration: metadata?.duration || null,

      fileSize: mediaInfo.fileSize,
      fileFormat: mediaInfo.fileFormat,
      privacyLevel: req.body.privacyLevel || "public",

      hashtags: hashtagArray,

      metadata: metadata
        ? {
            fileName: metadata.fileName,
            fileType: mediaInfo.mimeType,
            fileSize: metadata.fileSize,
            width: metadata.width,
            height: metadata.height,
            duration: metadata.duration,
            bitrate: metadata.bitrate,
            codec: metadata.codec,
            colorSpace: metadata.colorSpace || null
          }
        : null
    };

    console.log("📦 FINAL postData:", postData);

    // -------------------------------
    // 10. Insert to Database
    // -------------------------------
    const result = await Post.createPost(postData);

    console.log("📌 DB Insert result:", result);

    if (!result.success) {
      console.log("❌ DB Insert Failed:", result.error);

      MediaHelper.deleteFile(permanentMediaPath);
      if (permanentThumbnailPath) MediaHelper.deleteFile(permanentThumbnailPath);

      return res.status(500).json({
        success: false,
        error: result.error
      });
    }

    // -------------------------------
    // Fetch created post
    // -------------------------------
    const createdPost = await Post.getPostById(result.postId, userId);

    console.log("📌 Post fetched after creation:", createdPost);

    return res.status(201).json({
      success: true,
      message: "Post created successfully",
      data: {
        post: createdPost,
        postId: result.postId,
        createdAt: result.createdAt
      }
    });

  } catch (error) {
    console.error("❌ Create Post Error:", error);

    if (req.files) {
      Object.values(req.files).forEach(fileArray => {
        fileArray?.forEach(file => MediaHelper.deleteFile(file.path));
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to create post"
    });
  }
},

  
  // Upload multiple media files (for gallery/carousel posts)
  uploadMultipleMedia: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      
      if (!req.files || !req.files.media || req.files.media.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No media files uploaded'
        });
      }
      
      const uploadedFiles = req.files.media;
      const results = [];
      
      // Process each file
      for (const file of uploadedFiles) {
        const mediaInfo = MediaHelper.getFileInfo(file);
        
        // Move to permanent location
        const permanentMediaPath = path.join(
          __dirname, 
          '..', 
          'uploads', 
          'posts', 
          mediaInfo.mediaType === 'image' ? 'images' : 
          mediaInfo.mediaType === 'video' ? 'videos' : 
          mediaInfo.mediaType === 'audio' ? 'audios' : 'documents',
          mediaInfo.fileName
        );
        
        await MediaHelper.moveFile(mediaInfo.filePath, permanentMediaPath);
        
        // Generate metadata
        const metadata = await MediaProcessor.generateMediaMetadata(
          permanentMediaPath,
          mediaInfo.mediaType
        );
        
        results.push({
          fileName: mediaInfo.fileName,
          originalName: mediaInfo.originalName,
          mediaUrl: MediaHelper.generateMediaUrl(mediaInfo.fileName, mediaInfo.mediaType),
          mediaType: mediaInfo.mediaType,
          fileSize: mediaInfo.fileSize,
          width: metadata?.width || null,
          height: metadata?.height || null,
          duration: metadata?.duration || null,
          metadata: metadata
        });
      }
      
      res.json({
        success: true,
        message: 'Files uploaded successfully',
        data: {
          files: results,
          count: results.length
        }
      });
      
    } catch (error) {
      console.error('❌ Upload Multiple Media Error:', error);
      
      // Clean up uploaded files
      if (req.files && req.files.media) {
        req.files.media.forEach(file => {
          MediaHelper.deleteFile(file.path);
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to upload files'
      });
    }
  },
  
  // Update post media
  updatePostMedia: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { postId } = req.params;
      
      // Verify post ownership
      const post = await Post.getPostById(postId, userId);
      if (!post || post.AuthorId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to update this post'
        });
      }
      
      if (!req.files || !req.files.media || req.files.media.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Media file is required'
        });
      }
      
      const mediaFile = req.files.media[0];
      const mediaInfo = MediaHelper.getFileInfo(mediaFile);
      
      // Generate metadata
      const metadata = await MediaProcessor.generateMediaMetadata(
        mediaInfo.filePath,
        mediaInfo.mediaType
      );
      
      // Move to permanent location
      const permanentMediaPath = path.join(
        __dirname, 
        '..', 
        'uploads', 
        'posts', 
        mediaInfo.mediaType === 'image' ? 'images' : 
        mediaInfo.mediaType === 'video' ? 'videos' : 
        mediaInfo.mediaType === 'audio' ? 'audios' : 'documents',
        mediaInfo.fileName
      );
      
      await MediaHelper.moveFile(mediaInfo.filePath, permanentMediaPath);
      
      // Update post in database
      const updateData = {
        mediaType: mediaInfo.mediaType,
        mediaUrl: MediaHelper.generateMediaUrl(mediaInfo.fileName, mediaInfo.mediaType),
        width: metadata?.width || null,
        height: metadata?.height || null,
        duration: metadata?.duration || null,
        fileSize: mediaInfo.fileSize,
        fileFormat: mediaInfo.extension.substring(1)
      };
      
      // Note: You'll need to add an updateMedia method to your Post model
      // For now, we'll update the whole post
      const updateResult = await Post.updatePost(postId, userId, updateData);
      
      if (!updateResult.success) {
        MediaHelper.deleteFile(permanentMediaPath);
        return res.status(500).json({
          success: false,
          error: updateResult.error
        });
      }
      
      // Delete old media file if it exists
      if (post.MediaUrl) {
        const oldMediaPath = path.join(__dirname, '..', post.MediaUrl);
        MediaHelper.deleteFile(oldMediaPath);
      }
      
      // Get updated post
      const updatedPost = await Post.getPostById(postId, userId);
      
      res.json({
        success: true,
        message: 'Post media updated successfully',
        data: updatedPost
      });
      
    } catch (error) {
      console.error('❌ Update Post Media Error:', error);
      
      // Clean up uploaded file
      if (req.files && req.files.media) {
        req.files.media.forEach(file => {
          MediaHelper.deleteFile(file.path);
        });
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to update post media'
      });
    }
  },
  
  // Upload avatar
  uploadAvatar: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'Avatar image is required'
        });
      }
      
      const fileInfo = MediaHelper.getFileInfo(req.file);
      
      // Validate it's an image
      if (!fileInfo.fileType.startsWith('image/')) {
        MediaHelper.deleteFile(fileInfo.filePath);
        return res.status(400).json({
          success: false,
          error: 'Only image files are allowed for avatar'
        });
      }
      
      // Resize and optimize avatar
      const avatarName = `avatar-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
      const avatarPath = path.join(__dirname, '..', 'uploads', 'avatars', avatarName);
      
      await sharp(fileInfo.filePath)
        .resize(200, 200, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 85 })
        .toFile(avatarPath);
      
      // Delete temporary file
      MediaHelper.deleteFile(fileInfo.filePath);
      
      // Generate avatar URL
      const avatarUrl = MediaHelper.generateAvatarUrl(avatarName);
      
      // Update user profile with new avatar
      const updateResult = await User.updateProfile(userId, { avatarUrl: avatarUrl });
      
      if (!updateResult.success) {
        MediaHelper.deleteFile(avatarPath);
        return res.status(500).json({
          success: false,
          error: updateResult.error
        });
      }
      
      // Delete old avatar if exists
      const user = await User.getUserById(userId);
      if (user.AvatarUrl && user.AvatarUrl !== avatarUrl) {
        const oldAvatarPath = path.join(__dirname, '..', user.AvatarUrl);
        MediaHelper.deleteFile(oldAvatarPath);
      }
      
      res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatarUrl: avatarUrl
        }
      });
      
    } catch (error) {
      console.error('❌ Upload Avatar Error:', error);
      
      // Clean up uploaded file
      if (req.file) {
        MediaHelper.deleteFile(req.file.path);
      }
      
      res.status(500).json({
        success: false,
        error: 'Failed to upload avatar'
      });
    }
  },
  
  // Get post by ID
  getPost: async (req, res) => {
    try {
      const { postId } = req.params;
      const userId = req.user?.userId;
      
      const post = await Post.getPostById(postId, userId);
      
      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found'
        });
      }
      
      res.json({
        success: true,
        data: post
      });
      
    } catch (error) {
      console.error('❌ Get Post Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get post'
      });
    }
  },
  
  // Get posts with filters
  getPosts: async (req, res) => {
    try {
      const userId = req.user?.userId;
      const {
        page = 1,
        limit = 20,
        userId: filterUserId,
        mediaType,
        hashtag,
        search,
        privacyLevel,
        sortBy
      } = req.query;
      
      const filters = {};
      if (filterUserId) filters.userId = parseInt(filterUserId);
      if (mediaType) filters.mediaType = mediaType;
      if (hashtag) filters.hashtag = hashtag;
      if (search) filters.search = search;
      if (privacyLevel) filters.privacyLevel = privacyLevel;
      if (sortBy) filters.sortBy = sortBy;
      
      const result = await Post.getPosts(
        filters,
        userId,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get Posts Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get posts'
      });
    }
  },
  
  // Update post
  updatePost: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { postId } = req.params;
      const { title, description, privacyLevel, hashtags } = req.body;
      
      const updateData = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (privacyLevel !== undefined) updateData.privacyLevel = privacyLevel;
      
      // Process hashtags if provided
      let hashtagArray = null;
      if (hashtags !== undefined) {
        hashtagArray = hashtags.split(',')
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0);
      }
      
      const result = await Post.updatePost(postId, userId, updateData);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      // Update hashtags if provided
      if (hashtagArray !== null) {
        // Note: You'll need to add a method to update hashtags in your Post model
        // For now, we'll skip this part
      }
      
      // Get updated post
      const updatedPost = await Post.getPostById(postId, userId);
      
      res.json({
        success: true,
        message: 'Post updated successfully',
        data: updatedPost
      });
      
    } catch (error) {
      console.error('❌ Update Post Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update post'
      });
    }
  },
  
  // Delete post
  deletePost: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { postId } = req.params;
      const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
      
      // Get post before deleting to get media paths
      const post = await Post.getPostById(postId, userId);
      
      if (!post) {
        return res.status(404).json({
          success: false,
          error: 'Post not found'
        });
      }
      
      // Check ownership or admin rights
      if (!isAdmin && post.AuthorId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Not authorized to delete this post'
        });
      }
      
      const result = await Post.deletePost(postId, userId, isAdmin);
      
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
        message: 'Post deleted successfully'
      });
      
    } catch (error) {
      console.error('❌ Delete Post Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete post'
      });
    }
  },
  
  // Like/unlike post
  toggleLike: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { postId } = req.params;
      const { reactionType = 'like' } = req.body;
      
      const result = await Post.toggleLike(postId, userId, reactionType);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: result.liked ? 'Post liked' : 'Post unliked',
        data: {
          liked: result.liked,
          action: result.action
        }
      });
      
    } catch (error) {
      console.error('❌ Toggle Like Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to toggle like'
      });
    }
  },
  
  // Get post likes
  getPostLikes: async (req, res) => {
    try {
      const { postId } = req.params;
      const { page = 1, limit = 50 } = req.query;
      
      const result = await Post.getPostLikes(
        postId,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get Post Likes Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get post likes'
      });
    }
  },
  
  // Add comment
  addComment: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { postId } = req.params;
      const { commentText, parentCommentId } = req.body;
      
      if (!commentText || commentText.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Comment text is required'
        });
      }
      
      const result = await Post.addComment(
        postId,
        userId,
        commentText.trim(),
        parentCommentId || null
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.status(201).json({
        success: true,
        message: 'Comment added successfully',
        data: {
          commentId: result.commentId,
          createdAt: result.createdAt
        }
      });
      
    } catch (error) {
      console.error('❌ Add Comment Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to add comment'
      });
    }
  },
  
  // Get comments
  getComments: async (req, res) => {
    try {
      const { postId } = req.params;
      const { parentCommentId, page = 1, limit = 20 } = req.query;
      
      const result = await Post.getComments(
        postId,
        parentCommentId || null,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get Comments Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get comments'
      });
    }
  },
  
  // Update comment
  updateComment: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { commentId } = req.params;
      const { commentText } = req.body;
      
      if (!commentText || commentText.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Comment text is required'
        });
      }
      
      const result = await Post.updateComment(
        commentId,
        userId,
        commentText.trim()
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Comment updated successfully'
      });
      
    } catch (error) {
      console.error('❌ Update Comment Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update comment'
      });
    }
  },
  
  // Delete comment
  deleteComment: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { commentId } = req.params;
      const isAdmin = req.user.role === 'admin' || req.user.role === 'superadmin';
      
      const result = await Post.deleteComment(commentId, userId, isAdmin);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Comment deleted successfully'
      });
      
    } catch (error) {
      console.error('❌ Delete Comment Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete comment'
      });
    }
  },
  
  // Like/unlike comment
  toggleCommentLike: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { commentId } = req.params;
      
      const result = await Post.toggleCommentLike(commentId, userId);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: result.liked ? 'Comment liked' : 'Comment unliked',
        data: {
          liked: result.liked,
          action: result.action
        }
      });
      
    } catch (error) {
      console.error('❌ Toggle Comment Like Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to toggle comment like'
      });
    }
  },
  
  // Get trending hashtags
  getTrendingHashtags: async (req, res) => {
    try {
      const { limit = 10, days = 7 } = req.query;
      
      const hashtags = await Post.getTrendingHashtags(
        parseInt(limit),
        parseInt(days)
      );
      
      res.json({
        success: true,
        data: hashtags
      });
      
    } catch (error) {
      console.error('❌ Get Trending Hashtags Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get trending hashtags'
      });
    }
  },
  
  // Search hashtags
  searchHashtags: async (req, res) => {
    try {
      const { q, limit = 10 } = req.query;
      
      if (!q || q.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Search query is required'
        });
      }
      
      const hashtags = await Post.searchHashtags(q.trim(), parseInt(limit));
      
      res.json({
        success: true,
        data: hashtags
      });
      
    } catch (error) {
      console.error('❌ Search Hashtags Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to search hashtags'
      });
    }
  },
  
  // Get posts by hashtag
  getPostsByHashtag: async (req, res) => {
    try {
      const { tag } = req.params;
      const userId = req.user?.userId;
      const { page = 1, limit = 20 } = req.query;
      
      if (!tag || tag.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Hashtag is required'
        });
      }
      
      const result = await Post.getPostsByHashtag(
        tag.trim().toLowerCase(),
        userId,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get Posts by Hashtag Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get posts by hashtag'
      });
    }
  },
  
  // Get user feed
  getUserFeed: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { page = 1, limit = 20 } = req.query;
      
      const result = await Post.getUserFeed(
        userId,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get User Feed Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user feed'
      });
    }
  },
  
  // Get user's liked posts
  getUserLikedPosts: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { page = 1, limit = 20 } = req.query;
      
      const result = await Post.getUserLikedPosts(
        userId,
        parseInt(page),
        parseInt(limit)
      );
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Get User Liked Posts Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get liked posts'
      });
    }
  },
  
  // Get post analytics
  getPostAnalytics: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { postId } = req.params;
      
      const result = await Post.getPostAnalytics(postId, userId);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        data: result.analytics
      });
      
    } catch (error) {
      console.error('❌ Get Post Analytics Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get post analytics'
      });
    }
  },
  
  // Report post
  reportPost: async (req, res) => {
    try {
       // -------------------------------
    const userId = req.body.userId || req.body.UserId || req.body.userid;
      const { postId } = req.params;
      const { reason, description } = req.body;
      
      if (!reason || reason.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Report reason is required'
        });
      }
      
      const result = await Post.reportPost(
        postId,
        userId,
        reason.trim(),
        description || null
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Post reported successfully'
      });
      
    } catch (error) {
      console.error('❌ Report Post Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to report post'
      });
    }
  },
  
  // Share post
  sharePost: async (req, res) => {
    try {
      const { postId } = req.params;
      
      const result = await Post.sharePost(postId);
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Post shared successfully'
      });
      
    } catch (error) {
      console.error('❌ Share Post Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to share post'
      });
    }
  },
  
  // Get similar posts
  getSimilarPosts: async (req, res) => {
    try {
      const { postId } = req.params;
      const { limit = 5 } = req.query;
      
      const posts = await Post.getSimilarPosts(postId, parseInt(limit));
      
      res.json({
        success: true,
        data: posts
      });
      
    } catch (error) {
      console.error('❌ Get Similar Posts Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get similar posts'
      });
    }
  }
};

module.exports = PostController;