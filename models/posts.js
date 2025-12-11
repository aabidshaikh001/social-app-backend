const connectToDB = require("../config/db");
const sql = require("mssql");

const Post = {
  createTable: async () => {
    try {
      const pool = await connectToDB();
      const query = `
        IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_NAME = 'Posts'
        )
        CREATE TABLE Posts (
          PostId INT PRIMARY KEY IDENTITY(1,1),
          UserId INT NOT NULL,
          Title VARCHAR(255),
          Description TEXT,
          MediaType VARCHAR(20) NOT NULL,
          MediaUrl VARCHAR(500) NOT NULL,
          ThumbnailUrl VARCHAR(500),
          Width INT,
          Height INT,
          Duration INT,
          FileSize BIGINT,
          FileFormat VARCHAR(20),
          PrivacyLevel VARCHAR(20) DEFAULT 'public',
          ViewCount INT DEFAULT 0,
          LikeCount INT DEFAULT 0,
          CommentCount INT DEFAULT 0,
          ShareCount INT DEFAULT 0,
          IsDeleted BIT DEFAULT 0,
          IsFlagged BIT DEFAULT 0,
          DeletedAt DATETIME,
          PublishedAt DATETIME DEFAULT GETDATE(),
          CreatedAt DATETIME DEFAULT GETDATE(),
          UpdatedAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE
        );
        
        -- Create related tables
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PostLikes')
        CREATE TABLE PostLikes (
          LikeId INT PRIMARY KEY IDENTITY(1,1),
          PostId INT NOT NULL,
          UserId INT NOT NULL,
          ReactionType VARCHAR(20) DEFAULT 'like',
          CreatedAt DATETIME DEFAULT GETDATE(),
          UpdatedAt DATETIME DEFAULT GETDATE(),
          UNIQUE(PostId, UserId),
          FOREIGN KEY (PostId) REFERENCES Posts(PostId) ON DELETE CASCADE,
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE
        );
        
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PostComments')
        CREATE TABLE PostComments (
          CommentId INT PRIMARY KEY IDENTITY(1,1),
          PostId INT NOT NULL,
          UserId INT NOT NULL,
          ParentCommentId INT,
          CommentText VARCHAR(MAX) NOT NULL,
          Depth INT DEFAULT 0,
          Path VARCHAR(MAX),
          LikeCount INT DEFAULT 0,
          IsEdited BIT DEFAULT 0,
          IsFlagged BIT DEFAULT 0,
          IsDeleted BIT DEFAULT 0,
          DeletedAt DATETIME,
          CreatedAt DATETIME DEFAULT GETDATE(),
          UpdatedAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (PostId) REFERENCES Posts(PostId) ON DELETE CASCADE,
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE,
          FOREIGN KEY (ParentCommentId) REFERENCES PostComments(CommentId)
        );
        
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'CommentLikes')
        CREATE TABLE CommentLikes (
          CommentLikeId INT PRIMARY KEY IDENTITY(1,1),
          CommentId INT NOT NULL,
          UserId INT NOT NULL,
          CreatedAt DATETIME DEFAULT GETDATE(),
          UNIQUE(CommentId, UserId),
          FOREIGN KEY (CommentId) REFERENCES PostComments(CommentId) ON DELETE CASCADE,
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE
        );
        
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Hashtags')
        CREATE TABLE Hashtags (
          HashtagId INT PRIMARY KEY IDENTITY(1,1),
          TagName VARCHAR(100) UNIQUE NOT NULL,
          UsageCount INT DEFAULT 0,
          CreatedAt DATETIME DEFAULT GETDATE()
        );
        
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'PostHashtags')
        CREATE TABLE PostHashtags (
          PostId INT NOT NULL,
          HashtagId INT NOT NULL,
          CreatedAt DATETIME DEFAULT GETDATE(),
          PRIMARY KEY (PostId, HashtagId),
          FOREIGN KEY (PostId) REFERENCES Posts(PostId) ON DELETE CASCADE,
          FOREIGN KEY (HashtagId) REFERENCES Hashtags(HashtagId) ON DELETE CASCADE
        );
        
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'MediaMetadata')
        CREATE TABLE MediaMetadata (
          MetadataId INT PRIMARY KEY IDENTITY(1,1),
          PostId INT NOT NULL,
          FileName VARCHAR(255),
          FileType VARCHAR(50),
          FileSize BIGINT,
          Width INT,
          Height INT,
          Duration INT,
          Bitrate INT,
          Codec VARCHAR(50),
          ColorSpace VARCHAR(50),
          CreatedAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (PostId) REFERENCES Posts(PostId) ON DELETE CASCADE
        );
      `;
      
      await pool.request().query(query);
      console.log("✅ Post-related tables created or already exist.");
    } catch (error) {
      console.error("❌ Error creating post tables:", error);
    }
  },

  // Create a new post
  createPost: async (postData) => {
    try {
      const pool = await connectToDB();
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Insert post
        const postResult = await transaction.request()
          .input("UserId", sql.Int, postData.userId)
          .input("Title", sql.VarChar(255), postData.title || null)
          .input("Description", sql.VarChar(500), postData.description || null)
          .input("MediaType", sql.VarChar(20), postData.mediaType)
          .input("MediaUrl", sql.VarChar(500), postData.mediaUrl)
          .input("ThumbnailUrl", sql.VarChar(500), postData.thumbnailUrl || null)
          .input("Width", sql.Int, postData.width || null)
          .input("Height", sql.Int, postData.height || null)
          .input("Duration", sql.Int, postData.duration || null)
          .input("FileSize", sql.BigInt, postData.fileSize || null)
          .input("FileFormat", sql.VarChar(20), postData.fileFormat || null)
          .input("PrivacyLevel", sql.VarChar(20), postData.privacyLevel || 'public')
          .query(`
            INSERT INTO Posts (
              UserId, Title, Description, MediaType, MediaUrl,
              ThumbnailUrl, Width, Height, Duration, FileSize,
              FileFormat, PrivacyLevel
            )
            OUTPUT INSERTED.PostId, INSERTED.CreatedAt
            VALUES (
              @UserId, @Title, @Description, @MediaType, @MediaUrl,
              @ThumbnailUrl, @Width, @Height, @Duration, @FileSize,
              @FileFormat, @PrivacyLevel
            );
          `);
        
        const postId = postResult.recordset[0].PostId;
        
        // Process hashtags if any
        if (postData.hashtags && postData.hashtags.length > 0) {
          const hashtagQueries = [];
          
          for (const tag of postData.hashtags) {
            const cleanTag = tag.replace('#', '').toLowerCase().trim();
            if (cleanTag.length === 0) continue;
            
            // Insert or update hashtag
            const tagResult = await transaction.request()
              .input("TagName", sql.VarChar(100), cleanTag)
              .query(`
                MERGE Hashtags AS target
                USING (SELECT @TagName AS TagName) AS source
                ON (target.TagName = source.TagName)
                WHEN MATCHED THEN
                  UPDATE SET UsageCount = UsageCount + 1
                WHEN NOT MATCHED THEN
                  INSERT (TagName, UsageCount)
                  VALUES (@TagName, 1)
                OUTPUT inserted.HashtagId;
              `);
            
            const hashtagId = tagResult.recordset[0].HashtagId;
            
            // Link hashtag to post
            await transaction.request()
              .input("PostId", sql.Int, postId)
              .input("HashtagId", sql.Int, hashtagId)
              .query(`
                INSERT INTO PostHashtags (PostId, HashtagId)
                VALUES (@PostId, @HashtagId);
              `);
          }
        }
        
        // Add media metadata if provided
        if (postData.metadata) {
          await transaction.request()
            .input("PostId", sql.Int, postId)
            .input("FileName", sql.VarChar(255), postData.metadata.fileName || null)
            .input("FileType", sql.VarChar(50), postData.metadata.fileType || null)
            .input("FileSize", sql.BigInt, postData.metadata.fileSize || null)
            .input("Width", sql.Int, postData.metadata.width || null)
            .input("Height", sql.Int, postData.metadata.height || null)
            .input("Duration", sql.Int, postData.metadata.duration || null)
            .input("Bitrate", sql.Int, postData.metadata.bitrate || null)
            .input("Codec", sql.VarChar(50), postData.metadata.codec || null)
            .input("ColorSpace", sql.VarChar(50), postData.metadata.colorSpace || null)
            .query(`
              INSERT INTO MediaMetadata (
                PostId, FileName, FileType, FileSize, Width, Height,
                Duration, Bitrate, Codec, ColorSpace
              )
              VALUES (
                @PostId, @FileName, @FileType, @FileSize, @Width, @Height,
                @Duration, @Bitrate, @Codec, @ColorSpace
              );
            `);
        }
        
        await transaction.commit();
        
        return {
          success: true,
          postId: postId,
          createdAt: postResult.recordset[0].CreatedAt
        };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error("❌ Create Post Error:", error.message);
      return { success: false, error: error.message };
    }
  },

  // Get post by ID
  getPostById: async (postId, viewerId = null) => {
    try {
      const pool = await connectToDB();
      
      // Check privacy
      let privacyCheck = "";
      if (viewerId) {
        privacyCheck = `
          AND (
            p.PrivacyLevel = 'public' 
            OR p.UserId = @ViewerId
            OR EXISTS (
              SELECT 1 FROM Follows f 
              WHERE f.FollowingId = p.UserId 
              AND f.FollowerId = @ViewerId
              AND p.PrivacyLevel = 'friends'
            )
          )
        `;
      } else {
        privacyCheck = "AND p.PrivacyLevel = 'public'";
      }
      
      const result = await pool.request()
        .input("PostId", sql.Int, postId)
        .input("ViewerId", sql.Int, viewerId)
        .query(`
          SELECT 
            p.*,
            u.UserId as AuthorId,
            u.Username,
            u.FullName as AuthorName,
            u.AvatarUrl as AuthorAvatar,
            (SELECT COUNT(*) FROM PostLikes WHERE PostId = p.PostId) as TotalLikes,
            (SELECT COUNT(*) FROM PostComments WHERE PostId = p.PostId AND IsDeleted = 0) as TotalComments,
            ${viewerId ? `(SELECT TOP 1 1 FROM PostLikes WHERE PostId = p.PostId AND UserId = @ViewerId) as IsLikedByViewer,` : ''}
            STRING_AGG(ht.TagName, ',') WITHIN GROUP (ORDER BY ht.TagName) as Hashtags
          FROM Posts p
          JOIN Users u ON p.UserId = u.UserId
          LEFT JOIN PostHashtags ph ON p.PostId = ph.PostId
          LEFT JOIN Hashtags ht ON ph.HashtagId = ht.HashtagId
          WHERE p.PostId = @PostId 
            AND p.IsDeleted = 0
            ${privacyCheck}
          GROUP BY 
            p.PostId, p.UserId, p.Title, p.Description, p.MediaType, p.MediaUrl, p.ThumbnailUrl,
            p.Width, p.Height, p.Duration, p.FileSize, p.FileFormat, p.PrivacyLevel,
            p.ViewCount, p.LikeCount, p.CommentCount, p.ShareCount, p.IsDeleted, p.IsFlagged,
            p.DeletedAt, p.PublishedAt, p.CreatedAt, p.UpdatedAt,
            u.UserId, u.Username, u.FullName, u.AvatarUrl
        `);
      
      if (!result.recordset[0]) return null;
      
      // Increment view count if viewer is not the author
      if (viewerId && result.recordset[0].AuthorId !== viewerId) {
        await pool.request()
          .input("PostId", sql.Int, postId)
          .query("UPDATE Posts SET ViewCount = ViewCount + 1 WHERE PostId = @PostId");
      }
      
      return result.recordset[0];
    } catch (error) {
      console.error("❌ Get Post by ID Error:", error);
      return null;
    }
  },

// Get posts with pagination and filters
// Get posts with pagination and filters
getPosts: async (filters = {}, viewerId = null, page = 1, limit = 20) => {
  try {
    const pool = await connectToDB();
    const offset = (page - 1) * limit;

    const request = pool.request();
    const countRequest = pool.request();

    // BASE WHERE CLAUSE
    let where = `WHERE p.IsDeleted = 0`;
    let whereForCount = `WHERE p.IsDeleted = 0`;

    // FILTER: userId
    if (filters.userId) {
      where += ` AND p.UserId = @UserId`;
      whereForCount += ` AND p.UserId = @UserId`;
      request.input("UserId", sql.Int, filters.userId);
      countRequest.input("UserId", sql.Int, filters.userId);
    }

    // FILTER: Media Type
    if (filters.mediaType) {
      where += ` AND p.MediaType = @MediaType`;
      whereForCount += ` AND p.MediaType = @MediaType`;
      request.input("MediaType", sql.VarChar(20), filters.mediaType);
      countRequest.input("MediaType", sql.VarChar(20), filters.mediaType);
    }

    // FILTER: Hashtag
    if (filters.hashtag) {
      where += ` AND EXISTS (
        SELECT 1 FROM PostHashtags ph 
        JOIN Hashtags h ON h.HashtagId = ph.HashtagId 
        WHERE ph.PostId = p.PostId AND h.TagName = @Hashtag
      )`;

      whereForCount += ` AND EXISTS (
        SELECT 1 FROM PostHashtags ph 
        JOIN Hashtags h ON h.HashtagId = ph.HashtagId 
        WHERE ph.PostId = p.PostId AND h.TagName = @Hashtag
      )`;

      request.input("Hashtag", sql.VarChar(100), filters.hashtag);
      countRequest.input("Hashtag", sql.VarChar(100), filters.hashtag);
    }

    // FILTER: Search
    if (filters.search) {
      where += ` AND (p.Title LIKE '%' + @Search + '%' OR p.Description LIKE '%' + @Search + '%')`;
      whereForCount += ` AND (p.Title LIKE '%' + @Search + '%' OR p.Description LIKE '%' + @Search + '%')`;

      request.input("Search", sql.VarChar(255), filters.search);
      countRequest.input("Search", sql.VarChar(255), filters.search);
    }

    // FILTER: Privacy
    if (!viewerId) {
      where += ` AND p.PrivacyLevel = 'public'`;
      whereForCount += ` AND p.PrivacyLevel = 'public'`;
    } else {
      request.input("ViewerId", sql.Int, viewerId);
      countRequest.input("ViewerId", sql.Int, viewerId);

      where += `
        AND (
          p.PrivacyLevel = 'public'
          OR p.UserId = @ViewerId
          OR (
            p.PrivacyLevel = 'friends'
            AND EXISTS (
              SELECT 1 FROM Follows f
              WHERE f.FollowerId = @ViewerId
              AND f.FollowingId = p.UserId
            )
          )
        )
      `;

      whereForCount += `
        AND (
          p.PrivacyLevel = 'public'
          OR p.UserId = @ViewerId
          OR (
            p.PrivacyLevel = 'friends'
            AND EXISTS (
              SELECT 1 FROM Follows f
              WHERE f.FollowerId = @ViewerId
              AND f.FollowingId = p.UserId
            )
          )
        )
      `;
    }

    // Sorting
    let orderBy = `ORDER BY p.CreatedAt DESC`;

    if (filters.sortBy === "popular") {
      orderBy = `
        ORDER BY 
          (p.LikeCount + p.CommentCount * 0.5 + p.ViewCount * 0.1) DESC,
          p.CreatedAt DESC
      `;
    }

    if (filters.sortBy === "trending") {
      orderBy = `
        ORDER BY 
          (p.LikeCount * 0.4 + p.CommentCount * 0.3 + p.ShareCount * 0.3)
          / POWER(DATEDIFF(HOUR, p.CreatedAt, GETDATE()) + 2, 1.8) DESC
      `;
    }

    // Pagination parameters
    request.input("Offset", sql.Int, offset);
    request.input("Limit", sql.Int, limit);

    // FINAL QUERY (BUG-FREE)
    const query = `
      ;WITH PostList AS (
        SELECT p.PostId
        FROM Posts p
        ${where}
      ),
      FinalPosts AS (
        SELECT 
          ROW_NUMBER() OVER (${orderBy}) AS RowNum,
          p.*,
          u.Username,
          u.FullName AS AuthorName,
          u.AvatarUrl AS AuthorAvatar,
          (SELECT COUNT(*) FROM PostLikes WHERE PostId = p.PostId) AS TotalLikes,
          (SELECT COUNT(*) FROM PostComments WHERE PostId = p.PostId AND IsDeleted = 0) AS TotalComments,
          ${
            viewerId
              ? `CASE WHEN EXISTS (
                  SELECT 1 FROM PostLikes 
                  WHERE PostId = p.PostId AND UserId = @ViewerId
                ) THEN 1 ELSE 0 END AS IsLikedByViewer,`
              : `0 AS IsLikedByViewer,`
          }
          STUFF((
            SELECT DISTINCT ',' + h.TagName
            FROM PostHashtags ph
            JOIN Hashtags h ON h.HashtagId = ph.HashtagId
            WHERE ph.PostId = p.PostId
            FOR XML PATH(''), TYPE
          ).value('.', 'NVARCHAR(MAX)'), 1, 1, '') AS Hashtags
        FROM Posts p
        JOIN Users u ON p.UserId = u.UserId
        WHERE p.PostId IN (SELECT PostId FROM PostList)
      )
      SELECT *
      FROM FinalPosts
      WHERE RowNum > @Offset AND RowNum <= @Offset + @Limit
      ORDER BY RowNum;
    `;

    const result = await request.query(query);

    // COUNT QUERY
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM Posts p
      ${whereForCount}
    `;

    const countResult = await countRequest.query(countQuery);

    return {
      posts: result.recordset,
      pagination: {
        page,
        limit,
        total: countResult.recordset[0].total,
        totalPages: Math.ceil(countResult.recordset[0].total / limit),
      },
    };

  } catch (error) {
    console.error("❌ Get Posts Error:", error);
    return {
      posts: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    };
  }
},

  // Update post
  updatePost: async (postId, userId, updateData) => {
    try {
      const pool = await connectToDB();
      
      // Verify ownership
      const ownershipCheck = await pool.request()
        .input("PostId", sql.Int, postId)
        .input("UserId", sql.Int, userId)
        .query("SELECT 1 FROM Posts WHERE PostId = @PostId AND UserId = @UserId AND IsDeleted = 0");
      
      if (ownershipCheck.recordset.length === 0) {
        return { success: false, error: "Post not found or unauthorized" };
      }
      
      const updates = [];
      const request = pool.request();
      
      if (updateData.title !== undefined) {
        updates.push("Title = @Title");
        request.input("Title", sql.VarChar(255), updateData.title);
      }
      
      if (updateData.description !== undefined) {
        updates.push("Description = @Description");
        request.input("Description", sql.VarChar(500), updateData.description);
      }
      
      if (updateData.privacyLevel !== undefined) {
        updates.push("PrivacyLevel = @PrivacyLevel");
        request.input("PrivacyLevel", sql.VarChar(20), updateData.privacyLevel);
      }
      
      if (updates.length === 0) {
        return { success: false, error: "No fields to update" };
      }
      
      updates.push("UpdatedAt = GETDATE()");
      request.input("PostId", sql.Int, postId);
      
      await request.query(`
        UPDATE Posts
        SET ${updates.join(', ')}
        WHERE PostId = @PostId
      `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Update Post Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Delete post (soft delete)
  deletePost: async (postId, userId, isAdmin = false) => {
    try {
      const pool = await connectToDB();
      
      let query = `
        UPDATE Posts
        SET IsDeleted = 1,
            DeletedAt = GETDATE(),
            UpdatedAt = GETDATE()
        WHERE PostId = @PostId
      `;
      
      const request = pool.request()
        .input("PostId", sql.Int, postId);
      
      if (!isAdmin) {
        query += " AND UserId = @UserId";
        request.input("UserId", sql.Int, userId);
      }
      
      const result = await request.query(query);
      
      if (result.rowsAffected[0] === 0) {
        return { success: false, error: "Post not found or unauthorized" };
      }
      
      return { success: true };
    } catch (error) {
      console.error("❌ Delete Post Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Like/unlike post
  toggleLike: async (postId, userId, reactionType = 'like') => {
    try {
      const pool = await connectToDB();
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Check if already liked
        const existingLike = await transaction.request()
          .input("PostId", sql.Int, postId)
          .input("UserId", sql.Int, userId)
          .query("SELECT LikeId FROM PostLikes WHERE PostId = @PostId AND UserId = @UserId");
        
        if (existingLike.recordset.length > 0) {
          // Unlike
          await transaction.request()
            .input("PostId", sql.Int, postId)
            .input("UserId", sql.Int, userId)
            .query("DELETE FROM PostLikes WHERE PostId = @PostId AND UserId = @UserId");
          
          // Decrement like count
          await transaction.request()
            .input("PostId", sql.Int, postId)
            .query("UPDATE Posts SET LikeCount = LikeCount - 1, UpdatedAt = GETDATE() WHERE PostId = @PostId");
          
          await transaction.commit();
          
          return { 
            success: true, 
            liked: false,
            action: 'unliked'
          };
        } else {
          // Like
          await transaction.request()
            .input("PostId", sql.Int, postId)
            .input("UserId", sql.Int, userId)
            .input("ReactionType", sql.VarChar(20), reactionType)
            .query(`
              INSERT INTO PostLikes (PostId, UserId, ReactionType)
              VALUES (@PostId, @UserId, @ReactionType)
            `);
          
          // Increment like count
          await transaction.request()
            .input("PostId", sql.Int, postId)
            .query("UPDATE Posts SET LikeCount = LikeCount + 1, UpdatedAt = GETDATE() WHERE PostId = @PostId");
          
          await transaction.commit();
          
          // Create notification (optional)
          // await Notification.createLikeNotification(postId, userId);
          
          return { 
            success: true, 
            liked: true,
            action: 'liked'
          };
        }
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error("❌ Toggle Like Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get post likes
  getPostLikes: async (postId, page = 1, limit = 50) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      const result = await pool.request()
        .input("PostId", sql.Int, postId)
        .query(`
          SELECT 
            pl.*,
            u.Username,
            u.FullName,
            u.AvatarUrl
          FROM PostLikes pl
          JOIN Users u ON pl.UserId = u.UserId
          WHERE pl.PostId = @PostId
          ORDER BY pl.CreatedAt DESC
          OFFSET ${offset} ROWS
          FETCH NEXT ${limit} ROWS ONLY;
        `);
      
      const countResult = await pool.request()
        .input("PostId", sql.Int, postId)
        .query("SELECT COUNT(*) as total FROM PostLikes WHERE PostId = @PostId");
      
      return {
        likes: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get Post Likes Error:", error);
      return { likes: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Add comment
  addComment: async (postId, userId, commentText, parentCommentId = null) => {
    try {
      const pool = await connectToDB();
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        let depth = 0;
        let path = null;
        
        if (parentCommentId) {
          // Get parent comment info
          const parentComment = await transaction.request()
            .input("ParentCommentId", sql.Int, parentCommentId)
            .query("SELECT Depth, Path FROM PostComments WHERE CommentId = @ParentCommentId AND IsDeleted = 0");
          
          if (parentComment.recordset.length === 0) {
            throw new Error("Parent comment not found");
          }
          
          depth = parentComment.recordset[0].Depth + 1;
          path = parentComment.recordset[0].Path 
            ? `${parentComment.recordset[0].Path}.${parentCommentId}`
            : `${parentCommentId}`;
        }
        
        // Insert comment
        const commentResult = await transaction.request()
          .input("PostId", sql.Int, postId)
          .input("UserId", sql.Int, userId)
          .input("ParentCommentId", sql.Int, parentCommentId)
          .input("CommentText", sql.VarChar(sql.MAX), commentText)
          .input("Depth", sql.Int, depth)
          .input("Path", sql.VarChar(sql.MAX), path)
          .query(`
            INSERT INTO PostComments (PostId, UserId, ParentCommentId, CommentText, Depth, Path)
            OUTPUT INSERTED.CommentId, INSERTED.CreatedAt
            VALUES (@PostId, @UserId, @ParentCommentId, @CommentText, @Depth, @Path)
          `);
        
        // Update post comment count
        await transaction.request()
          .input("PostId", sql.Int, postId)
          .query("UPDATE Posts SET CommentCount = CommentCount + 1, UpdatedAt = GETDATE() WHERE PostId = @PostId");
        
        await transaction.commit();
        
        return {
          success: true,
          commentId: commentResult.recordset[0].CommentId,
          createdAt: commentResult.recordset[0].CreatedAt
        };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error("❌ Add Comment Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get comments for post
  getComments: async (postId, parentCommentId = null, page = 1, limit = 20) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      let whereClause = "WHERE pc.PostId = @PostId AND pc.IsDeleted = 0";
      if (parentCommentId) {
        whereClause += " AND pc.ParentCommentId = @ParentCommentId";
      } else {
        whereClause += " AND pc.ParentCommentId IS NULL";
      }
      
      const request = pool.request()
        .input("PostId", sql.Int, postId);
      
      if (parentCommentId) {
        request.input("ParentCommentId", sql.Int, parentCommentId);
      }
      
      const result = await request.query(`
        SELECT 
          pc.*,
          u.Username,
          u.FullName,
          u.AvatarUrl,
          (SELECT COUNT(*) FROM PostComments child WHERE child.ParentCommentId = pc.CommentId AND child.IsDeleted = 0) as ReplyCount,
          (SELECT COUNT(*) FROM CommentLikes cl WHERE cl.CommentId = pc.CommentId) as TotalLikes
        FROM PostComments pc
        JOIN Users u ON pc.UserId = u.UserId
        ${whereClause}
        ORDER BY pc.CreatedAt DESC
        OFFSET ${offset} ROWS
        FETCH NEXT ${limit} ROWS ONLY;
      `);
      
      const countResult = await request.query(`
        SELECT COUNT(*) as total
        FROM PostComments pc
        ${whereClause}
      `);
      
      return {
        comments: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get Comments Error:", error);
      return { comments: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Get comment thread
  getCommentThread: async (commentId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("CommentId", sql.Int, commentId)
        .query(`
          WITH CommentHierarchy AS (
            SELECT * FROM PostComments WHERE CommentId = @CommentId AND IsDeleted = 0
            UNION ALL
            SELECT pc.* FROM PostComments pc
            INNER JOIN CommentHierarchy ch ON pc.ParentCommentId = ch.CommentId
            WHERE pc.IsDeleted = 0
          )
          SELECT 
            ch.*,
            u.Username,
            u.FullName,
            u.AvatarUrl,
            (SELECT COUNT(*) FROM CommentLikes cl WHERE cl.CommentId = ch.CommentId) as TotalLikes
          FROM CommentHierarchy ch
          JOIN Users u ON ch.UserId = u.UserId
          ORDER BY ch.Path;
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Get Comment Thread Error:", error);
      return [];
    }
  },

  // Update comment
  updateComment: async (commentId, userId, commentText) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("CommentId", sql.Int, commentId)
        .input("UserId", sql.Int, userId)
        .input("CommentText", sql.VarChar(sql.MAX), commentText)
        .query(`
          UPDATE PostComments
          SET CommentText = @CommentText,
              IsEdited = 1,
              UpdatedAt = GETDATE()
          WHERE CommentId = @CommentId 
            AND UserId = @UserId
            AND IsDeleted = 0
        `);
      
      if (result.rowsAffected[0] === 0) {
        return { success: false, error: "Comment not found or unauthorized" };
      }
      
      return { success: true };
    } catch (error) {
      console.error("❌ Update Comment Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Delete comment
  deleteComment: async (commentId, userId, isAdmin = false) => {
    try {
      const pool = await connectToDB();
      
      let query = `
        UPDATE PostComments
        SET IsDeleted = 1,
            DeletedAt = GETDATE(),
            UpdatedAt = GETDATE()
        WHERE CommentId = @CommentId
      `;
      
      const request = pool.request()
        .input("CommentId", sql.Int, commentId);
      
      if (!isAdmin) {
        query += " AND UserId = @UserId";
        request.input("UserId", sql.Int, userId);
      }
      
      const result = await request.query(query);
      
      if (result.rowsAffected[0] === 0) {
        return { success: false, error: "Comment not found or unauthorized" };
      }
      
      // Update post comment count
      await pool.request()
        .input("CommentId", sql.Int, commentId)
        .query(`
          UPDATE Posts
          SET CommentCount = CommentCount - 1
          WHERE PostId = (SELECT PostId FROM PostComments WHERE CommentId = @CommentId)
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Delete Comment Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Like/unlike comment
  toggleCommentLike: async (commentId, userId) => {
    try {
      const pool = await connectToDB();
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Check if already liked
        const existingLike = await transaction.request()
          .input("CommentId", sql.Int, commentId)
          .input("UserId", sql.Int, userId)
          .query("SELECT CommentLikeId FROM CommentLikes WHERE CommentId = @CommentId AND UserId = @UserId");
        
        if (existingLike.recordset.length > 0) {
          // Unlike
          await transaction.request()
            .input("CommentId", sql.Int, commentId)
            .input("UserId", sql.Int, userId)
            .query("DELETE FROM CommentLikes WHERE CommentId = @CommentId AND UserId = @UserId");
          
          // Decrement like count
          await transaction.request()
            .input("CommentId", sql.Int, commentId)
            .query(`
              UPDATE PostComments 
              SET LikeCount = LikeCount - 1 
              WHERE CommentId = @CommentId
            `);
          
          await transaction.commit();
          
          return { 
            success: true, 
            liked: false,
            action: 'unliked'
          };
        } else {
          // Like
          await transaction.request()
            .input("CommentId", sql.Int, commentId)
            .input("UserId", sql.Int, userId)
            .query(`
              INSERT INTO CommentLikes (CommentId, UserId)
              VALUES (@CommentId, @UserId)
            `);
          
          // Increment like count
          await transaction.request()
            .input("CommentId", sql.Int, commentId)
            .query(`
              UPDATE PostComments 
              SET LikeCount = LikeCount + 1 
              WHERE CommentId = @CommentId
            `);
          
          await transaction.commit();
          
          return { 
            success: true, 
            liked: true,
            action: 'liked'
          };
        }
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error("❌ Toggle Comment Like Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get trending hashtags
  getTrendingHashtags: async (limit = 10, days = 7) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("Days", sql.Int, days)
        .input("Limit", sql.Int, limit)
        .query(`
          SELECT TOP (@Limit)
            h.HashtagId,
            h.TagName,
            h.UsageCount,
            COUNT(ph.PostId) as RecentUsage,
            MAX(p.CreatedAt) as LastUsed
          FROM Hashtags h
          JOIN PostHashtags ph ON h.HashtagId = ph.HashtagId
          JOIN Posts p ON ph.PostId = p.PostId
          WHERE p.CreatedAt >= DATEADD(DAY, -@Days, GETDATE())
            AND p.IsDeleted = 0
          GROUP BY h.HashtagId, h.TagName, h.UsageCount
          ORDER BY RecentUsage DESC, h.UsageCount DESC
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Get Trending Hashtags Error:", error);
      return [];
    }
  },

  // Search hashtags
  searchHashtags: async (searchTerm, limit = 10) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("SearchTerm", sql.VarChar(100), `%${searchTerm}%`)
        .input("Limit", sql.Int, limit)
        .query(`
          SELECT TOP (@Limit)
            HashtagId,
            TagName,
            UsageCount,
            CreatedAt
          FROM Hashtags
          WHERE TagName LIKE @SearchTerm
          ORDER BY UsageCount DESC
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Search Hashtags Error:", error);
      return [];
    }
  },

  // Get posts by hashtag
  getPostsByHashtag: async (tagName, viewerId = null, page = 1, limit = 20) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      let privacyCheck = "";
      if (viewerId) {
        privacyCheck = `
          AND (
            p.PrivacyLevel = 'public' 
            OR p.UserId = @ViewerId
            OR EXISTS (
              SELECT 1 FROM Follows f 
              WHERE f.FollowingId = p.UserId 
              AND f.FollowerId = @ViewerId
              AND p.PrivacyLevel = 'friends'
            )
          )
        `;
      } else {
        privacyCheck = "AND p.PrivacyLevel = 'public'";
      }
      
      const result = await pool.request()
        .input("TagName", sql.VarChar(100), tagName)
        .input("ViewerId", sql.Int, viewerId)
        .query(`
          SELECT 
            p.*,
            u.Username,
            u.FullName as AuthorName,
            u.AvatarUrl as AuthorAvatar,
            (SELECT COUNT(*) FROM PostLikes pl WHERE pl.PostId = p.PostId) as TotalLikes,
            (SELECT COUNT(*) FROM PostComments pc WHERE pc.PostId = p.PostId AND pc.IsDeleted = 0) as TotalComments
          FROM Posts p
          JOIN Users u ON p.UserId = u.UserId
          JOIN PostHashtags ph ON p.PostId = ph.PostId
          JOIN Hashtags h ON ph.HashtagId = h.HashtagId
          WHERE h.TagName = @TagName
            AND p.IsDeleted = 0
            ${privacyCheck}
          ORDER BY p.CreatedAt DESC
          OFFSET ${offset} ROWS
          FETCH NEXT ${limit} ROWS ONLY;
        `);
      
      const countResult = await pool.request()
        .input("TagName", sql.VarChar(100), tagName)
        .input("ViewerId", sql.Int, viewerId)
        .query(`
          SELECT COUNT(*) as total
          FROM Posts p
          JOIN PostHashtags ph ON p.PostId = ph.PostId
          JOIN Hashtags h ON ph.HashtagId = h.HashtagId
          WHERE h.TagName = @TagName
            AND p.IsDeleted = 0
            ${privacyCheck}
        `);
      
      return {
        posts: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get Posts by Hashtag Error:", error);
      return { posts: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Get user feed (posts from followed users)
getUserFeed: async (userId, page = 1, limit = 20) => {
  try {
    const pool = await connectToDB();
    const offset = (page - 1) * limit;

    const feedQuery = `
      SELECT 
        p.*,
        u.Username,
        u.FullName AS AuthorName,
        u.AvatarUrl AS AuthorAvatar,
        (SELECT COUNT(*) FROM PostLikes pl WHERE pl.PostId = p.PostId) AS TotalLikes,
        (SELECT COUNT(*) FROM PostComments pc WHERE pc.PostId = p.PostId AND pc.IsDeleted = 0) AS TotalComments,
        CASE 
          WHEN EXISTS (
            SELECT 1 FROM PostLikes pl2 
            WHERE pl2.PostId = p.PostId AND pl2.UserId = @UserId
          ) THEN 1 ELSE 0 END AS IsLikedByViewer
      FROM Posts p
      JOIN Users u ON p.UserId = u.UserId
      WHERE p.IsDeleted = 0
        AND (
            p.UserId = @UserId  -- User's own posts
            OR p.PrivacyLevel = 'public' -- Public posts always visible
            OR (
                p.PrivacyLevel = 'friends'
                AND EXISTS (
                  SELECT 1 FROM Follows f
                  WHERE f.FollowerId = @UserId
                  AND f.FollowingId = p.UserId
                )
            )
        )
      ORDER BY p.CreatedAt DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `;

    const result = await pool.request()
      .input("UserId", sql.Int, userId)
      .input("Offset", sql.Int, offset)
      .input("Limit", sql.Int, limit)
      .query(feedQuery);

    // COUNT QUERY
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM Posts p
      WHERE p.IsDeleted = 0
        AND (
            p.UserId = @UserId
            OR p.PrivacyLevel = 'public'
            OR (
                p.PrivacyLevel = 'friends'
                AND EXISTS (
                  SELECT 1 FROM Follows f
                  WHERE f.FollowerId = @UserId
                  AND f.FollowingId = p.UserId
                )
            )
        );
    `;

    const countResult = await pool.request()
      .input("UserId", sql.Int, userId)
      .query(countQuery);

    return {
      posts: result.recordset,
      pagination: {
        page,
        limit,
        total: countResult.recordset[0].total,
        totalPages: Math.ceil(countResult.recordset[0].total / limit)
      }
    };

  } catch (error) {
    console.error("❌ Get User Feed Error:", error);
    return { posts: [], pagination: { page, limit, total: 0, totalPages: 0 } };
  }
},

  // Get user's liked posts
  getUserLikedPosts: async (userId, page = 1, limit = 20) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT 
            p.*,
            u.Username,
            u.FullName as AuthorName,
            u.AvatarUrl as AuthorAvatar,
            (SELECT COUNT(*) FROM PostLikes pl WHERE pl.PostId = p.PostId) as TotalLikes,
            (SELECT COUNT(*) FROM PostComments pc WHERE pc.PostId = p.PostId AND pc.IsDeleted = 0) as TotalComments,
            1 as IsLikedByViewer,
            pl.CreatedAt as LikedAt
          FROM Posts p
          JOIN Users u ON p.UserId = u.UserId
          JOIN PostLikes pl ON p.PostId = pl.PostId
          WHERE pl.UserId = @UserId
            AND p.IsDeleted = 0
            AND (
              p.PrivacyLevel = 'public'
              OR p.UserId = @UserId
              OR EXISTS (
                SELECT 1 FROM Follows f 
                WHERE f.FollowingId = p.UserId 
                AND f.FollowerId = @UserId
                AND p.PrivacyLevel = 'friends'
              )
            )
          ORDER BY pl.CreatedAt DESC
          OFFSET ${offset} ROWS
          FETCH NEXT ${limit} ROWS ONLY;
        `);
      
      const countResult = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT COUNT(*) as total
          FROM PostLikes pl
          JOIN Posts p ON pl.PostId = p.PostId
          WHERE pl.UserId = @UserId
            AND p.IsDeleted = 0
            AND (
              p.PrivacyLevel = 'public'
              OR p.UserId = @UserId
              OR EXISTS (
                SELECT 1 FROM Follows f 
                WHERE f.FollowingId = p.UserId 
                AND f.FollowerId = @UserId
                AND p.PrivacyLevel = 'friends'
              )
            )
        `);
      
      return {
        posts: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get User Liked Posts Error:", error);
      return { posts: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Get post analytics
  getPostAnalytics: async (postId, userId) => {
    try {
      const pool = await connectToDB();
      
      // Verify ownership
      const ownershipCheck = await pool.request()
        .input("PostId", sql.Int, postId)
        .input("UserId", sql.Int, userId)
        .query("SELECT 1 FROM Posts WHERE PostId = @PostId AND UserId = @UserId");
      
      if (ownershipCheck.recordset.length === 0) {
        return { success: false, error: "Unauthorized" };
      }
      
      const result = await pool.request()
        .input("PostId", sql.Int, postId)
        .query(`
          -- Basic stats
          SELECT 
            p.ViewCount,
            p.LikeCount,
            p.CommentCount,
            p.ShareCount,
            DATEDIFF(HOUR, p.CreatedAt, GETDATE()) as HoursSinceCreation,
            -- Engagement rate
            CAST(p.LikeCount AS FLOAT) / NULLIF(p.ViewCount, 0) * 100 as EngagementRate,
            -- Daily averages
            p.ViewCount / NULLIF(DATEDIFF(DAY, p.CreatedAt, GETDATE()) + 1, 0) as AvgDailyViews,
            p.LikeCount / NULLIF(DATEDIFF(DAY, p.CreatedAt, GETDATE()) + 1, 0) as AvgDailyLikes,
            -- Recent activity
            (SELECT COUNT(*) FROM PostLikes pl 
             WHERE pl.PostId = @PostId 
             AND pl.CreatedAt >= DATEADD(DAY, -1, GETDATE())) as LikesLast24h,
            (SELECT COUNT(*) FROM PostComments pc 
             WHERE pc.PostId = @PostId 
             AND pc.CreatedAt >= DATEADD(DAY, -1, GETDATE())
             AND pc.IsDeleted = 0) as CommentsLast24h
          FROM Posts p
          WHERE p.PostId = @PostId
          
          -- Top likers
          UNION ALL
          SELECT TOP 5
            pl.UserId,
            u.Username,
            u.FullName,
            COUNT(*) as LikeCount,
            MAX(pl.CreatedAt) as LastLiked
          FROM PostLikes pl
          JOIN Users u ON pl.UserId = u.UserId
          WHERE pl.PostId = @PostId
          GROUP BY pl.UserId, u.Username, u.FullName
          ORDER BY COUNT(*) DESC
          
          -- Comment statistics
          UNION ALL
          SELECT 
            COUNT(*) as TotalComments,
            COUNT(DISTINCT pc.UserId) as UniqueCommenters,
            AVG(LEN(pc.CommentText)) as AvgCommentLength,
            MAX(pc.CreatedAt) as LastCommentTime
          FROM PostComments pc
          WHERE pc.PostId = @PostId AND pc.IsDeleted = 0
        `);
      
      // The result will have multiple result sets
      const records = result.recordset;
      
      return {
        success: true,
        analytics: {
          basicStats: records[0] || {},
          topLikers: records.slice(1, 6) || [],
          commentStats: records[6] || {}
        }
      };
    } catch (error) {
      console.error("❌ Get Post Analytics Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get similar posts
  getSimilarPosts: async (postId, limit = 5) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("PostId", sql.Int, postId)
        .input("Limit", sql.Int, limit)
        .query(`
          SELECT TOP (@Limit)
            p2.*,
            u.Username,
            u.FullName as AuthorName,
            u.AvatarUrl as AuthorAvatar,
            -- Calculate similarity score
            (
              -- Hashtag overlap
              (SELECT COUNT(*) FROM PostHashtags ph1
               JOIN PostHashtags ph2 ON ph1.HashtagId = ph2.HashtagId
               WHERE ph1.PostId = @PostId AND ph2.PostId = p2.PostId)
              +
              -- Same author bonus
              CASE WHEN p1.UserId = p2.UserId THEN 2 ELSE 0 END
              +
              -- Same media type bonus
              CASE WHEN p1.MediaType = p2.MediaType THEN 1 ELSE 0 END
            ) as SimilarityScore
          FROM Posts p1
          CROSS JOIN Posts p2
          JOIN Users u ON p2.UserId = u.UserId
          WHERE p1.PostId = @PostId
            AND p2.PostId != @PostId
            AND p2.IsDeleted = 0
            AND p2.PrivacyLevel = 'public'
          ORDER BY SimilarityScore DESC, p2.CreatedAt DESC
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Get Similar Posts Error:", error);
      return [];
    }
  },

  // Report post
  reportPost: async (postId, reporterId, reason, description = null) => {
    try {
      const pool = await connectToDB();
      
      // Check if already reported by this user
      const existingReport = await pool.request()
        .input("PostId", sql.Int, postId)
        .input("ReporterId", sql.Int, reporterId)
        .query(`
          SELECT 1 FROM Reports 
          WHERE EntityType = 'Post' 
            AND EntityId = @PostId 
            AND ReporterId = @ReporterId
            AND Status = 'pending'
        `);
      
      if (existingReport.recordset.length > 0) {
        return { success: false, error: "You have already reported this post" };
      }
      
      await pool.request()
        .input("ReporterId", sql.Int, reporterId)
        .input("EntityId", sql.Int, postId)
        .input("Reason", sql.VarChar(50), reason)
        .input("Description", sql.VarChar(500), description)
        .query(`
          INSERT INTO Reports (ReporterId, EntityType, EntityId, Reason, Description)
          VALUES (@ReporterId, 'Post', @EntityId, @Reason, @Description)
        `);
      
      // Flag the post for review
      await pool.request()
        .input("PostId", sql.Int, postId)
        .query("UPDATE Posts SET IsFlagged = 1 WHERE PostId = @PostId");
      
      return { success: true };
    } catch (error) {
      console.error("❌ Report Post Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Share post (increment share count)
  sharePost: async (postId) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("PostId", sql.Int, postId)
        .query("UPDATE Posts SET ShareCount = ShareCount + 1 WHERE PostId = @PostId");
      
      return { success: true };
    } catch (error) {
      console.error("❌ Share Post Error:", error);
      return { success: false, error: error.message };
    }
  }
};

module.exports = Post;