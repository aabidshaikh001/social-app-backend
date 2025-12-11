const connectToDB = require("../config/db");
const sql = require("mssql");

const Notification = {
  createTable: async () => {
    try {
      const pool = await connectToDB();
      const query = `
        IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_NAME = 'Notifications'
        )
        CREATE TABLE Notifications (
          NotificationId INT PRIMARY KEY IDENTITY(1,1),
          UserId INT NOT NULL,
          ActorId INT NOT NULL,
          Type VARCHAR(50) NOT NULL,
          PostId INT,
          CommentId INT,
          IsRead BIT DEFAULT 0,
          CreatedAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE,
          FOREIGN KEY (ActorId) REFERENCES Users(UserId),
          FOREIGN KEY (PostId) REFERENCES Posts(PostId) ON DELETE SET NULL,
          FOREIGN KEY (CommentId) REFERENCES PostComments(CommentId) ON DELETE SET NULL
        );
      `;
      await pool.request().query(query);
      console.log("✅ Notifications table created or already exists.");
    } catch (error) {
      console.error("❌ Error creating notifications table:", error);
    }
  },

  // Create notification
  createNotification: async (notificationData) => {
    try {
      const pool = await connectToDB();
      
      // Don't notify self
      if (notificationData.userId === notificationData.actorId) {
        return { success: false, error: "Cannot notify yourself" };
      }
      
      const result = await pool.request()
        .input("UserId", sql.Int, notificationData.userId)
        .input("ActorId", sql.Int, notificationData.actorId)
        .input("Type", sql.VarChar(50), notificationData.type)
        .input("PostId", sql.Int, notificationData.postId || null)
        .input("CommentId", sql.Int, notificationData.commentId || null)
        .query(`
          INSERT INTO Notifications (UserId, ActorId, Type, PostId, CommentId)
          OUTPUT INSERTED.NotificationId, INSERTED.CreatedAt
          VALUES (@UserId, @ActorId, @Type, @PostId, @CommentId)
        `);
      
      return {
        success: true,
        notificationId: result.recordset[0].NotificationId,
        createdAt: result.recordset[0].CreatedAt
      };
    } catch (error) {
      console.error("❌ Create Notification Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get user notifications
  getUserNotifications: async (userId, page = 1, limit = 20, unreadOnly = false) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      let whereClause = "WHERE n.UserId = @UserId";
      if (unreadOnly) {
        whereClause += " AND n.IsRead = 0";
      }
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT 
            n.*,
            a.Username as ActorUsername,
            a.FullName as ActorFullName,
            a.AvatarUrl as ActorAvatar,
            p.Title as PostTitle,
            p.MediaUrl as PostMediaUrl,
            pc.CommentText as CommentText
          FROM Notifications n
          JOIN Users a ON n.ActorId = a.UserId
          LEFT JOIN Posts p ON n.PostId = p.PostId
          LEFT JOIN PostComments pc ON n.CommentId = pc.CommentId
          ${whereClause}
          ORDER BY n.CreatedAt DESC
          OFFSET ${offset} ROWS
          FETCH NEXT ${limit} ROWS ONLY;
        `);
      
      const countResult = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT COUNT(*) as total
          FROM Notifications n
          ${whereClause}
        `);
      
      // Mark as read if viewing unread
      if (unreadOnly && result.recordset.length > 0) {
        await pool.request()
          .input("UserId", sql.Int, userId)
          .query(`
            UPDATE Notifications 
            SET IsRead = 1 
            WHERE UserId = @UserId AND IsRead = 0
          `);
      }
      
      return {
        notifications: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get User Notifications Error:", error);
      return { notifications: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Mark notification as read
  markAsRead: async (notificationId, userId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("NotificationId", sql.Int, notificationId)
        .input("UserId", sql.Int, userId)
        .query(`
          UPDATE Notifications 
          SET IsRead = 1 
          WHERE NotificationId = @NotificationId AND UserId = @UserId
        `);
      
      if (result.rowsAffected[0] === 0) {
        return { success: false, error: "Notification not found or unauthorized" };
      }
      
      return { success: true };
    } catch (error) {
      console.error("❌ Mark Notification as Read Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Mark all notifications as read
  markAllAsRead: async (userId) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          UPDATE Notifications 
          SET IsRead = 1 
          WHERE UserId = @UserId AND IsRead = 0
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Mark All Notifications as Read Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Delete notification
  deleteNotification: async (notificationId, userId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("NotificationId", sql.Int, notificationId)
        .input("UserId", sql.Int, userId)
        .query("DELETE FROM Notifications WHERE NotificationId = @NotificationId AND UserId = @UserId");
      
      if (result.rowsAffected[0] === 0) {
        return { success: false, error: "Notification not found or unauthorized" };
      }
      
      return { success: true };
    } catch (error) {
      console.error("❌ Delete Notification Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Clear all notifications
  clearAllNotifications: async (userId) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .query("DELETE FROM Notifications WHERE UserId = @UserId");
      
      return { success: true };
    } catch (error) {
      console.error("❌ Clear All Notifications Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Get unread count
  getUnreadCount: async (userId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query("SELECT COUNT(*) as count FROM Notifications WHERE UserId = @UserId AND IsRead = 0");
      
      return result.recordset[0].count;
    } catch (error) {
      console.error("❌ Get Unread Count Error:", error);
      return 0;
    }
  },

  // Helper functions for specific notification types
  createLikeNotification: async (postId, actorId) => {
    try {
      // Get post owner
      const pool = await connectToDB();
      
      const postResult = await pool.request()
        .input("PostId", sql.Int, postId)
        .query("SELECT UserId FROM Posts WHERE PostId = @PostId");
      
      if (postResult.recordset.length === 0) return;
      
      const postOwnerId = postResult.recordset[0].UserId;
      
      return await Notification.createNotification({
        userId: postOwnerId,
        actorId: actorId,
        type: 'like',
        postId: postId
      });
    } catch (error) {
      console.error("❌ Create Like Notification Error:", error);
    }
  },

  createCommentNotification: async (postId, commentId, actorId) => {
    try {
      const pool = await connectToDB();
      
      // Get post owner and comment info
      const result = await pool.request()
        .input("PostId", sql.Int, postId)
        .input("CommentId", sql.Int, commentId)
        .query(`
          SELECT 
            p.UserId as PostOwnerId,
            pc.UserId as CommentOwnerId,
            pc.ParentCommentId
          FROM Posts p
          JOIN PostComments pc ON p.PostId = pc.PostId
          WHERE p.PostId = @PostId AND pc.CommentId = @CommentId
        `);
      
      if (result.recordset.length === 0) return;
      
      const postOwnerId = result.recordset[0].PostOwnerId;
      const commentOwnerId = result.recordset[0].CommentOwnerId;
      const parentCommentId = result.recordset[0].ParentCommentId;
      
      // Notify post owner (if not the commenter)
      if (postOwnerId !== actorId) {
        await Notification.createNotification({
          userId: postOwnerId,
          actorId: actorId,
          type: 'comment',
          postId: postId,
          commentId: commentId
        });
      }
      
      // Notify parent comment owner if this is a reply
      if (parentCommentId) {
        const parentResult = await pool.request()
          .input("ParentCommentId", sql.Int, parentCommentId)
          .query("SELECT UserId FROM PostComments WHERE CommentId = @ParentCommentId");
        
        if (parentResult.recordset.length > 0) {
          const parentOwnerId = parentResult.recordset[0].UserId;
          if (parentOwnerId !== actorId) {
            await Notification.createNotification({
              userId: parentOwnerId,
              actorId: actorId,
              type: 'reply',
              postId: postId,
              commentId: commentId
            });
          }
        }
      }
    } catch (error) {
      console.error("❌ Create Comment Notification Error:", error);
    }
  },

  createFollowNotification: async (followerId, followingId) => {
    try {
      return await Notification.createNotification({
        userId: followingId,
        actorId: followerId,
        type: 'follow'
      });
    } catch (error) {
      console.error("❌ Create Follow Notification Error:", error);
    }
  }
};

module.exports = Notification;