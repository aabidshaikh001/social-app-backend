const connectToDB = require("../config/db");
const sql = require("mssql");

const Follow = {
  createTable: async () => {
    try {
      const pool = await connectToDB();
      const query = `
        IF NOT EXISTS (
          SELECT * FROM INFORMATION_SCHEMA.TABLES 
          WHERE TABLE_NAME = 'Follows'
        )
        CREATE TABLE Follows (
          FollowId INT PRIMARY KEY IDENTITY(1,1),
          FollowerId INT NOT NULL,
          FollowingId INT NOT NULL,
          CreatedAt DATETIME DEFAULT GETDATE(),
          UNIQUE(FollowerId, FollowingId),
          FOREIGN KEY (FollowerId) REFERENCES Users(UserId) ON DELETE CASCADE,
          FOREIGN KEY (FollowingId) REFERENCES Users(UserId) ON DELETE CASCADE
        );
      `;
      await pool.request().query(query);
      console.log("✅ Follows table created or already exists.");
    } catch (error) {
      console.error("❌ Error creating follows table:", error);
    }
  },

  // Follow user
  followUser: async (followerId, followingId) => {
    try {
      if (followerId === followingId) {
        return { success: false, error: "Cannot follow yourself" };
      }
      
      const pool = await connectToDB();
      
      // Check if already following
      const existingFollow = await pool.request()
        .input("FollowerId", sql.Int, followerId)
        .input("FollowingId", sql.Int, followingId)
        .query("SELECT FollowId FROM Follows WHERE FollowerId = @FollowerId AND FollowingId = @FollowingId");
      
      if (existingFollow.recordset.length > 0) {
        return { success: false, error: "Already following this user" };
      }
      
      // Check if user exists and is active
      const userCheck = await pool.request()
        .input("FollowingId", sql.Int, followingId)
        .query("SELECT 1 FROM Users WHERE UserId = @FollowingId AND IsActive = 1 AND IsBanned = 0 AND DeletedAt IS NULL");
      
      if (userCheck.recordset.length === 0) {
        return { success: false, error: "User not found or inactive" };
      }
      
      await pool.request()
        .input("FollowerId", sql.Int, followerId)
        .input("FollowingId", sql.Int, followingId)
        .query(`
          INSERT INTO Follows (FollowerId, FollowingId)
          VALUES (@FollowerId, @FollowingId)
        `);
      
      // Create notification (optional)
      // await Notification.createFollowNotification(followerId, followingId);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Follow User Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Unfollow user
  unfollowUser: async (followerId, followingId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("FollowerId", sql.Int, followerId)
        .input("FollowingId", sql.Int, followingId)
        .query("DELETE FROM Follows WHERE FollowerId = @FollowerId AND FollowingId = @FollowingId");
      
      if (result.rowsAffected[0] === 0) {
        return { success: false, error: "Not following this user" };
      }
      
      return { success: true };
    } catch (error) {
      console.error("❌ Unfollow User Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Check if following
  isFollowing: async (followerId, followingId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("FollowerId", sql.Int, followerId)
        .input("FollowingId", sql.Int, followingId)
        .query("SELECT 1 FROM Follows WHERE FollowerId = @FollowerId AND FollowingId = @FollowingId");
      
      return result.recordset.length > 0;
    } catch (error) {
      console.error("❌ Check Following Error:", error);
      return false;
    }
  },

  // Get followers
  getFollowers: async (userId, page = 1, limit = 20) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT 
            f.FollowerId,
            u.Username,
            u.FullName,
            u.AvatarUrl,
            u.Bio,
            f.CreatedAt as FollowedAt,
            -- Check if mutual follow
            (SELECT 1 FROM Follows f2 
             WHERE f2.FollowerId = @UserId 
             AND f2.FollowingId = f.FollowerId) as IsFollowingBack
          FROM Follows f
          JOIN Users u ON f.FollowerId = u.UserId
          WHERE f.FollowingId = @UserId
            AND u.IsActive = 1
            AND u.IsBanned = 0
            AND u.DeletedAt IS NULL
          ORDER BY f.CreatedAt DESC
          OFFSET ${offset} ROWS
          FETCH NEXT ${limit} ROWS ONLY;
        `);
      
      const countResult = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT COUNT(*) as total
          FROM Follows f
          JOIN Users u ON f.FollowerId = u.UserId
          WHERE f.FollowingId = @UserId
            AND u.IsActive = 1
            AND u.IsBanned = 0
            AND u.DeletedAt IS NULL
        `);
      
      return {
        followers: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get Followers Error:", error);
      return { followers: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Get following
  getFollowing: async (userId, page = 1, limit = 20) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT 
            f.FollowingId,
            u.Username,
            u.FullName,
            u.AvatarUrl,
            u.Bio,
            f.CreatedAt as FollowedAt,
            -- Check if mutual follow
            (SELECT 1 FROM Follows f2 
             WHERE f2.FollowerId = f.FollowingId 
             AND f2.FollowingId = @UserId) as IsFollowedBack
          FROM Follows f
          JOIN Users u ON f.FollowingId = u.UserId
          WHERE f.FollowerId = @UserId
            AND u.IsActive = 1
            AND u.IsBanned = 0
            AND u.DeletedAt IS NULL
          ORDER BY f.CreatedAt DESC
          OFFSET ${offset} ROWS
          FETCH NEXT ${limit} ROWS ONLY;
        `);
      
      const countResult = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT COUNT(*) as total
          FROM Follows f
          JOIN Users u ON f.FollowingId = u.UserId
          WHERE f.FollowerId = @UserId
            AND u.IsActive = 1
            AND u.IsBanned = 0
            AND u.DeletedAt IS NULL
        `);
      
      return {
        following: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get Following Error:", error);
      return { following: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Get follow suggestions
  getFollowSuggestions: async (userId, limit = 10) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .input("Limit", sql.Int, limit)
        .query(`
          SELECT TOP (@Limit)
            u.UserId,
            u.Username,
            u.FullName,
            u.AvatarUrl,
            u.Bio,
            -- Followers of your followers
            (SELECT COUNT(*) FROM Follows f2 
             WHERE f2.FollowingId = u.UserId 
             AND f2.FollowerId IN (
               SELECT f3.FollowingId FROM Follows f3 
               WHERE f3.FollowerId = @UserId
             )) as MutualConnections,
            -- Total followers
            (SELECT COUNT(*) FROM Follows f4 
             WHERE f4.FollowingId = u.UserId) as FollowerCount,
            -- Recent activity
            (SELECT COUNT(*) FROM Posts p 
             WHERE p.UserId = u.UserId 
             AND p.CreatedAt >= DATEADD(DAY, -7, GETDATE())) as RecentPosts
          FROM Users u
          WHERE u.UserId != @UserId
            AND u.IsActive = 1
            AND u.IsBanned = 0
            AND u.DeletedAt IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM Follows f 
              WHERE f.FollowerId = @UserId 
              AND f.FollowingId = u.UserId
            )
          ORDER BY MutualConnections DESC, FollowerCount DESC, RecentPosts DESC
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Get Follow Suggestions Error:", error);
      return [];
    }
  },

  // Get follower count
  getFollowerCount: async (userId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query("SELECT COUNT(*) as count FROM Follows WHERE FollowingId = @UserId");
      
      return result.recordset[0].count;
    } catch (error) {
      console.error("❌ Get Follower Count Error:", error);
      return 0;
    }
  },

  // Get following count
  getFollowingCount: async (userId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query("SELECT COUNT(*) as count FROM Follows WHERE FollowerId = @UserId");
      
      return result.recordset[0].count;
    } catch (error) {
      console.error("❌ Get Following Count Error:", error);
      return 0;
    }
  },

  // Get mutual followers
  getMutualFollowers: async (userId1, userId2) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("UserId1", sql.Int, userId1)
        .input("UserId2", sql.Int, userId2)
        .query(`
          SELECT u.UserId, u.Username, u.FullName, u.AvatarUrl
          FROM Users u
          WHERE EXISTS (
            SELECT 1 FROM Follows f1 
            WHERE f1.FollowingId = u.UserId 
            AND f1.FollowerId = @UserId1
          )
          AND EXISTS (
            SELECT 1 FROM Follows f2 
            WHERE f2.FollowingId = u.UserId 
            AND f2.FollowerId = @UserId2
          )
          AND u.IsActive = 1
          AND u.IsBanned = 0
          AND u.DeletedAt IS NULL
          ORDER BY u.Username
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Get Mutual Followers Error:", error);
      return [];
    }
  }
};

module.exports = Follow;