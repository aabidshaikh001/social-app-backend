const connectToDB = require("../config/db");
const sql = require("mssql");
const crypto = require("crypto");

const User = {
  createAllTables: async () => {
    try {
      const pool = await connectToDB();
      const query = `
        -- Create Users table
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Users')
        CREATE TABLE Users (
          UserId INT PRIMARY KEY IDENTITY(1,1),
          Username VARCHAR(50) UNIQUE NOT NULL,
          FullName VARCHAR(150) NOT NULL,
          Email VARCHAR(150) UNIQUE NOT NULL,
          EmailVerified BIT DEFAULT 0,
          PasswordHash VARCHAR(255) NOT NULL,
          PasswordSalt VARCHAR(128),
          Role VARCHAR(20) NOT NULL DEFAULT 'user',
          AvatarUrl VARCHAR(500),
          Bio TEXT,
          Location VARCHAR(100),
          Website VARCHAR(500),
          IsActive BIT DEFAULT 1,
          IsBanned BIT DEFAULT 0,
          LastLoginAt DATETIME,
          LoginAttempts INT DEFAULT 0,
          LockedUntil DATETIME,
          CreatedAt DATETIME DEFAULT GETDATE(),
          UpdatedAt DATETIME DEFAULT GETDATE(),
          DeletedAt DATETIME
        );

        -- Create UserSettings table
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'UserSettings')
        CREATE TABLE UserSettings (
          UserId INT PRIMARY KEY,
          EmailNotifications BIT DEFAULT 1,
          PushNotifications BIT DEFAULT 1,
          PrivacyProfile VARCHAR(20) DEFAULT 'public',
          Language VARCHAR(10) DEFAULT 'en',
          TimeZone VARCHAR(50),
          Theme VARCHAR(20) DEFAULT 'light',
          UpdatedAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE
        );

        -- Create Sessions table
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Sessions')
        CREATE TABLE Sessions (
          SessionId VARCHAR(128) PRIMARY KEY,
          UserId INT NOT NULL,
          DeviceInfo VARCHAR(500),
          IpAddress VARCHAR(45),
          UserAgent VARCHAR(500),
          IsRevoked BIT DEFAULT 0,
          ExpiresAt DATETIME NOT NULL,
          LastActivityAt DATETIME DEFAULT GETDATE(),
          CreatedAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE CASCADE
        );

        -- Create AuditLogs table
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'AuditLogs')
        CREATE TABLE AuditLogs (
          LogId INT PRIMARY KEY IDENTITY(1,1),
          UserId INT NULL,
          Action VARCHAR(100) NOT NULL,
          EntityType VARCHAR(50) NOT NULL,
          EntityId INT NULL,
          OldValues NVARCHAR(MAX),
          NewValues NVARCHAR(MAX),
          IpAddress VARCHAR(45),
          UserAgent VARCHAR(500),
          CreatedAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE SET NULL
        );

        -- Create RateLimitLogs table
        IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'RateLimitLogs')
        CREATE TABLE RateLimitLogs (
          Id INT PRIMARY KEY IDENTITY(1,1),
          UserId INT NULL,
          IpAddress VARCHAR(45) NOT NULL,
          UserAgent VARCHAR(500),
          Endpoint VARCHAR(200) NOT NULL,
          Method VARCHAR(10) NOT NULL,
          StatusCode INT,
          RequestSize INT,
          ResponseTime INT,
          RequestAt DATETIME DEFAULT GETDATE(),
          FOREIGN KEY (UserId) REFERENCES Users(UserId) ON DELETE SET NULL
        );
      `;
      
      await pool.request().query(query);
      
      // Create indexes
      await User.createIndexes();
      
      console.log("✅ All user-related tables created or already exist.");
    } catch (error) {
      console.error("❌ Error creating user tables:", error);
    }
  },

  createIndexes: async () => {
    try {
      const pool = await connectToDB();
      const indexes = [
        "CREATE INDEX IX_Users_Username ON Users(Username)",
        "CREATE INDEX IX_Users_Email ON Users(Email)",
        "CREATE INDEX IX_Users_Role ON Users(Role)",
        "CREATE INDEX IX_Users_CreatedAt ON Users(CreatedAt)",
        "CREATE INDEX IX_Users_IsActive ON Users(IsActive)",
        "CREATE INDEX IX_Sessions_UserId ON Sessions(UserId)",
        "CREATE INDEX IX_Sessions_ExpiresAt ON Sessions(ExpiresAt)",
        "CREATE INDEX IX_Sessions_IsRevoked ON Sessions(IsRevoked)",
        "CREATE INDEX IX_AuditLogs_UserId ON AuditLogs(UserId)",
        "CREATE INDEX IX_AuditLogs_Action ON AuditLogs(Action)",
        "CREATE INDEX IX_AuditLogs_CreatedAt ON AuditLogs(CreatedAt)",
        "CREATE INDEX IX_RateLimitLogs_IpAddress ON RateLimitLogs(IpAddress)",
        "CREATE INDEX IX_RateLimitLogs_UserId ON RateLimitLogs(UserId)",
        "CREATE INDEX IX_RateLimitLogs_RequestAt ON RateLimitLogs(RequestAt)"
      ];
      
      for (const indexQuery of indexes) {
        try {
          await pool.request().query(indexQuery);
        } catch (err) {
          if (!err.message.includes('already exists')) {
            console.warn("⚠️ Warning creating index:", err.message);
          }
        }
      }
    } catch (error) {
      console.error("❌ Error creating indexes:", error);
    }
  },

  // Generate password hash and salt
  generatePasswordHash: (password) => {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return { hash, salt };
  },

  // Verify password
  verifyPassword: (password, hash, salt) => {
    const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
  },

  // Create a new user (register)
  createUser: async (userData, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Check if username or email already exists
        const existingUser = await transaction.request()
          .input("Username", sql.VarChar(50), userData.username)
          .input("Email", sql.VarChar(150), userData.email)
          .query(`
            SELECT UserId FROM Users 
            WHERE (Username = @Username OR Email = @Email) 
              AND DeletedAt IS NULL
          `);
        
        if (existingUser.recordset.length > 0) {
          await transaction.rollback();
          return { 
            success: false, 
            error: "Username or email already exists" 
          };
        }

        // Generate password hash
        const passwordData = User.generatePasswordHash(userData.password);
        
        // Insert user
        const result = await transaction.request()
          .input("Username", sql.VarChar(50), userData.username)
          .input("FullName", sql.VarChar(150), userData.fullName)
          .input("Email", sql.VarChar(150), userData.email)
          .input("PasswordHash", sql.VarChar(255), passwordData.hash)
          .input("PasswordSalt", sql.VarChar(128), passwordData.salt)
          .input("Role", sql.VarChar(20), userData.role || 'user')
          .query(`
            INSERT INTO Users (
              Username, FullName, Email, PasswordHash, PasswordSalt, Role
            )
            OUTPUT INSERTED.UserId, INSERTED.Username, INSERTED.Email, INSERTED.Role, INSERTED.CreatedAt
            VALUES (
              @Username, @FullName, @Email, @PasswordHash, @PasswordSalt, @Role
            );
          `);

        const userId = result.recordset[0].UserId;
        
        // Create default user settings
        await transaction.request()
          .input("UserId", sql.Int, userId)
          .query(`
            INSERT INTO UserSettings (UserId)
            VALUES (@UserId);
          `);
        
        // Create audit log
        await transaction.request()
          .input("UserId", sql.Int, userId)
          .input("Action", sql.VarChar(100), "USER_REGISTER")
          .input("EntityType", sql.VarChar(50), "User")
          .input("EntityId", sql.Int, userId)
          .input("IpAddress", sql.VarChar(45), ipAddress)
          .input("UserAgent", sql.VarChar(500), userAgent)
          .query(`
            INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
            VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
          `);
        
        await transaction.commit();
        
        return { 
          success: true, 
          user: {
            userId: result.recordset[0].UserId,
            username: result.recordset[0].Username,
            email: result.recordset[0].Email,
            role: result.recordset[0].Role,
            createdAt: result.recordset[0].CreatedAt
          }
        };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error("❌ Create User Error:", error.message);
      return { success: false, error: error.message };
    }
  },

  // Authenticate user (login)
  authenticateUser: async (username, password, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      // Get user with password hash
      const result = await pool.request()
        .input("Username", sql.VarChar(50), username)
        .query(`
          SELECT 
            UserId, Username, Email, PasswordHash, PasswordSalt, Role,
            IsActive, IsBanned, LoginAttempts, LockedUntil,
            EmailVerified, FullName, AvatarUrl
          FROM Users 
          WHERE (Username = @Username OR Email = @Username)
            AND DeletedAt IS NULL
        `);
      
      if (result.recordset.length === 0) {
        return { 
          success: false, 
          error: "Invalid credentials",
          code: "INVALID_CREDENTIALS"
        };
      }
      
      const user = result.recordset[0];
      
      // Check if account is locked
      if (user.LockedUntil && new Date(user.LockedUntil) > new Date()) {
        return { 
          success: false, 
          error: "Account is locked. Try again later.",
          code: "ACCOUNT_LOCKED"
        };
      }
      
      // Check if account is banned
      if (user.IsBanned) {
        return { 
          success: false, 
          error: "Account is banned",
          code: "ACCOUNT_BANNED"
        };
      }
      
      // Check if account is active
      if (!user.IsActive) {
        return { 
          success: false, 
          error: "Account is deactivated",
          code: "ACCOUNT_DEACTIVATED"
        };
      }
      
      // Verify password
      const isValidPassword = User.verifyPassword(password, user.PasswordHash, user.PasswordSalt);
      
      if (!isValidPassword) {
        // Increment login attempts
        const newAttempts = user.LoginAttempts + 1;
        let lockUntil = null;
        
        if (newAttempts >= 5) {
          // Lock account for 30 minutes
          lockUntil = new Date(Date.now() + 30 * 60 * 1000);
        }
        
        await User.updateLoginAttempts(user.UserId, newAttempts, lockUntil);
        
        return { 
          success: false, 
          error: "Invalid credentials",
          code: "INVALID_CREDENTIALS",
          attempts: newAttempts,
          locked: newAttempts >= 5
        };
      }
      
      // Reset login attempts on successful login
      await User.updateLoginAttempts(user.UserId, 0, null);
      
      // Update last login
      await User.updateLastLogin(user.UserId, ipAddress);
      
      // Create audit log
      await pool.request()
        .input("UserId", sql.Int, user.UserId)
        .input("Action", sql.VarChar(100), "USER_LOGIN")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, user.UserId)
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
        `);
      
      // Remove sensitive data
      delete user.PasswordHash;
      delete user.PasswordSalt;
      
      return { 
        success: true, 
        user: user
      };
    } catch (error) {
      console.error("❌ Authenticate User Error:", error.message);
      return { success: false, error: error.message };
    }
  },

  // Get user by ID (with settings)
  getUserById: async (userId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT 
            u.*,
            s.EmailNotifications, s.PushNotifications, s.PrivacyProfile,
            s.Language, s.TimeZone, s.Theme
          FROM Users u
          LEFT JOIN UserSettings s ON u.UserId = s.UserId
          WHERE u.UserId = @UserId 
            AND u.DeletedAt IS NULL
        `);
      
      if (!result.recordset[0]) return null;
      
      const user = result.recordset[0];
      delete user.PasswordHash;
      delete user.PasswordSalt;
      
      return user;
    } catch (error) {
      console.error("❌ Get User by ID Error:", error);
      return null;
    }
  },

  // Get user by username or email
  getUserByUsernameOrEmail: async (identifier) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("Identifier", sql.VarChar(150), identifier)
        .query(`
          SELECT 
            u.*,
            s.EmailNotifications, s.PushNotifications
          FROM Users u
          LEFT JOIN UserSettings s ON u.UserId = s.UserId
          WHERE (u.Username = @Identifier OR u.Email = @Identifier)
            AND u.DeletedAt IS NULL
        `);
      
      if (!result.recordset[0]) return null;
      
      const user = result.recordset[0];
      delete user.PasswordHash;
      delete user.PasswordSalt;
      
      return user;
    } catch (error) {
      console.error("❌ Get User by Username/Email Error:", error);
      return null;
    }
  },

  // Update password
  updatePassword: async (userId, oldPassword, newPassword, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Get current password hash
        const currentUser = await transaction.request()
          .input("UserId", sql.Int, userId)
          .query("SELECT PasswordHash, PasswordSalt FROM Users WHERE UserId = @UserId");
        
        if (currentUser.recordset.length === 0) {
          await transaction.rollback();
          return { success: false, error: "User not found" };
        }
        
        const { PasswordHash, PasswordSalt } = currentUser.recordset[0];
        
        // Verify old password
        const isValid = User.verifyPassword(oldPassword, PasswordHash, PasswordSalt);
        if (!isValid) {
          await transaction.rollback();
          return { success: false, error: "Current password is incorrect" };
        }
        
        // Generate new password hash
        const newPasswordData = User.generatePasswordHash(newPassword);
        
        // Update password
        await transaction.request()
          .input("UserId", sql.Int, userId)
          .input("PasswordHash", sql.VarChar(255), newPasswordData.hash)
          .input("PasswordSalt", sql.VarChar(128), newPasswordData.salt)
          .query(`
            UPDATE Users
            SET PasswordHash = @PasswordHash,
                PasswordSalt = @PasswordSalt,
                UpdatedAt = GETDATE()
            WHERE UserId = @UserId;
          `);
        
        // Create audit log
        await transaction.request()
          .input("UserId", sql.Int, userId)
          .input("Action", sql.VarChar(100), "PASSWORD_CHANGE")
          .input("EntityType", sql.VarChar(50), "User")
          .input("EntityId", sql.Int, userId)
          .input("IpAddress", sql.VarChar(45), ipAddress)
          .input("UserAgent", sql.VarChar(500), userAgent)
          .query(`
            INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
            VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
          `);
        
        await transaction.commit();
        return { success: true };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error("❌ Update Password Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Reset password (admin or forgot password)
  resetPassword: async (userId, newPassword, resetBy = null, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      // Generate new password hash
      const passwordData = User.generatePasswordHash(newPassword);
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .input("PasswordHash", sql.VarChar(255), passwordData.hash)
        .input("PasswordSalt", sql.VarChar(128), passwordData.salt)
        .query(`
          UPDATE Users
          SET PasswordHash = @PasswordHash,
              PasswordSalt = @PasswordSalt,
              UpdatedAt = GETDATE()
          WHERE UserId = @UserId;
        `);
      
      // Create audit log
      await pool.request()
        .input("UserId", sql.Int, resetBy || userId)
        .input("Action", sql.VarChar(100), "PASSWORD_RESET")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, userId)
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Reset Password Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Update profile
updateProfile: async (userId, updateData, ipAddress = null, userAgent = null) => {
  try {
    const pool = await connectToDB();
    const transaction = new sql.Transaction(pool);
    
    await transaction.begin();
    
    try {
      // Get old values for audit log
      const oldUser = await transaction.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT FullName, Bio, Location, Website, AvatarUrl, CoverImage
          FROM Users WHERE UserId = @UserId
        `);
      
      const oldValues = oldUser.recordset[0] ? JSON.stringify(oldUser.recordset[0]) : null;
      
      // Build update query
      const updates = [];
      const request = transaction.request();
      
      if (updateData.fullName !== undefined) {
        updates.push("FullName = @FullName");
        request.input("FullName", sql.VarChar(150), updateData.fullName);
      }
      
      if (updateData.bio !== undefined) {
        updates.push("Bio = @Bio");
        request.input("Bio", sql.Text, updateData.bio);
      }
      
      if (updateData.location !== undefined) {
        updates.push("Location = @Location");
        request.input("Location", sql.VarChar(100), updateData.location);
      }
      
      if (updateData.website !== undefined) {
        updates.push("Website = @Website");
        request.input("Website", sql.VarChar(500), updateData.website);
      }
      
      if (updateData.avatarUrl !== undefined) {
        updates.push("AvatarUrl = @AvatarUrl");
        request.input("AvatarUrl", sql.VarChar(500), updateData.avatarUrl);
      }
      
      if (updateData.coverImage !== undefined) {
        updates.push("CoverImage = @CoverImage");
        request.input("CoverImage", sql.VarChar(500), updateData.coverImage);
      }
      
      if (updates.length === 0) {
        await transaction.rollback();
        return { success: false, error: "No fields to update" };
      }
      
      updates.push("UpdatedAt = GETDATE()");
      request.input("UserId", sql.Int, userId);
      
      await request.query(`
        UPDATE Users
        SET ${updates.join(', ')}
        WHERE UserId = @UserId AND DeletedAt IS NULL;
      `);
      
      // Create audit log
      const newValues = JSON.stringify({
        fullName: updateData.fullName,
        bio: updateData.bio,
        location: updateData.location,
        website: updateData.website,
        avatarUrl: updateData.avatarUrl,
        coverImage: updateData.coverImage
      });
      
      await transaction.request()
        .input("UserId", sql.Int, userId)
        .input("Action", sql.VarChar(100), "PROFILE_UPDATE")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, userId)
        .input("OldValues", sql.NVarChar(sql.MAX), oldValues)
        .input("NewValues", sql.NVarChar(sql.MAX), newValues)
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, OldValues, NewValues, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @OldValues, @NewValues, @IpAddress, @UserAgent);
        `);
      
      await transaction.commit();
      return { success: true };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("❌ Update Profile Error:", error);
    return { success: false, error: error.message };
  }
},

  // Update user settings
  updateUserSettings: async (userId, settings, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Get old settings for audit log
        const oldSettings = await transaction.request()
          .input("UserId", sql.Int, userId)
          .query(`
            SELECT EmailNotifications, PushNotifications, PrivacyProfile, Language, TimeZone, Theme
            FROM UserSettings WHERE UserId = @UserId
          `);
        
        const oldValues = oldSettings.recordset[0] ? JSON.stringify(oldSettings.recordset[0]) : null;
        
        // Build update query
        const updates = [];
        const request = transaction.request();
        
        if (settings.emailNotifications !== undefined) {
          updates.push("EmailNotifications = @EmailNotifications");
          request.input("EmailNotifications", sql.Bit, settings.emailNotifications);
        }
        
        if (settings.pushNotifications !== undefined) {
          updates.push("PushNotifications = @PushNotifications");
          request.input("PushNotifications", sql.Bit, settings.pushNotifications);
        }
        
        if (settings.privacyProfile !== undefined) {
          updates.push("PrivacyProfile = @PrivacyProfile");
          request.input("PrivacyProfile", sql.VarChar(20), settings.privacyProfile);
        }
        
        if (settings.language !== undefined) {
          updates.push("Language = @Language");
          request.input("Language", sql.VarChar(10), settings.language);
        }
        
        if (settings.timeZone !== undefined) {
          updates.push("TimeZone = @TimeZone");
          request.input("TimeZone", sql.VarChar(50), settings.timeZone);
        }
        
        if (settings.theme !== undefined) {
          updates.push("Theme = @Theme");
          request.input("Theme", sql.VarChar(20), settings.theme);
        }
        
        if (updates.length === 0) {
          await transaction.rollback();
          return { success: false, error: "No settings to update" };
        }
        
        updates.push("UpdatedAt = GETDATE()");
        request.input("UserId", sql.Int, userId);
        
        await request.query(`
          UPDATE UserSettings
          SET ${updates.join(', ')}
          WHERE UserId = @UserId;
        `);
        
        // Create audit log
        const newValues = JSON.stringify(settings);
        
        await transaction.request()
          .input("UserId", sql.Int, userId)
          .input("Action", sql.VarChar(100), "SETTINGS_UPDATE")
          .input("EntityType", sql.VarChar(50), "UserSettings")
          .input("EntityId", sql.Int, userId)
          .input("OldValues", sql.NVarChar(sql.MAX), oldValues)
          .input("NewValues", sql.NVarChar(sql.MAX), newValues)
          .input("IpAddress", sql.VarChar(45), ipAddress)
          .input("UserAgent", sql.VarChar(500), userAgent)
          .query(`
            INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, OldValues, NewValues, IpAddress, UserAgent)
            VALUES (@UserId, @Action, @EntityType, @EntityId, @OldValues, @NewValues, @IpAddress, @UserAgent);
          `);
        
        await transaction.commit();
        return { success: true };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error("❌ Update User Settings Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Update last login
  updateLastLogin: async (userId, ipAddress = null) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          UPDATE Users
          SET LastLoginAt = GETDATE(),
              UpdatedAt = GETDATE()
          WHERE UserId = @UserId;
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Update Last Login Error:", error);
      return { success: false, error: error.message };
    }
  },
  // --------------------------------------
// Get user suggestions (people you may know)
// --------------------------------------
getUserSuggestions: async (userId, limit = 5) => {
  try {
    const pool = await connectToDB();

    const result = await pool.request()
      .input("UserId", sql.Int, userId)
      .input("Limit", sql.Int, limit)
      .query(`
        SELECT TOP (@Limit)
          UserId, Username, FullName, AvatarUrl, Bio
        FROM Users
        WHERE UserId != @UserId
          AND IsActive = 1
          AND IsBanned = 0
          AND DeletedAt IS NULL
        ORDER BY NEWID(); -- random suggestions
      `);

    return result.recordset;

  } catch (error) {
    console.error("❌ Get User Suggestions Error:", error);
    return [];
  }
},


  // Update login attempts
  updateLoginAttempts: async (userId, attempts, lockUntil = null) => {
    try {
      const pool = await connectToDB();
      
      const request = pool.request()
        .input("UserId", sql.Int, userId)
        .input("LoginAttempts", sql.Int, attempts);
      
      let lockClause = "";
      if (lockUntil) {
        lockClause = ", LockedUntil = @LockedUntil";
        request.input("LockedUntil", sql.DateTime, lockUntil);
      }
      
      await request.query(`
        UPDATE Users
        SET LoginAttempts = @LoginAttempts
            ${lockClause},
            UpdatedAt = GETDATE()
        WHERE UserId = @UserId;
      `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Update Login Attempts Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Update email verification status
  updateEmailVerification: async (userId, isVerified, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .input("EmailVerified", sql.Bit, isVerified)
        .query(`
          UPDATE Users
          SET EmailVerified = @EmailVerified,
              UpdatedAt = GETDATE()
          WHERE UserId = @UserId;
        `);
      
      // Create audit log
      await pool.request()
        .input("UserId", sql.Int, userId)
        .input("Action", sql.VarChar(100), isVerified ? "EMAIL_VERIFIED" : "EMAIL_UNVERIFIED")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, userId)
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Update Email Verification Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Deactivate user (soft delete)
  deactivateUser: async (userId, deactivatedBy = null, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          UPDATE Users
          SET IsActive = 0,
              DeletedAt = GETDATE(),
              UpdatedAt = GETDATE()
          WHERE UserId = @UserId AND DeletedAt IS NULL;
        `);
      
      // Create audit log
      await pool.request()
        .input("UserId", sql.Int, deactivatedBy || userId)
        .input("Action", sql.VarChar(100), "USER_DEACTIVATED")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, userId)
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Deactivate User Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Reactivate user
  reactivateUser: async (userId, reactivatedBy = null, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          UPDATE Users
          SET IsActive = 1,
              DeletedAt = NULL,
              UpdatedAt = GETDATE()
          WHERE UserId = @UserId;
        `);
      
      // Create audit log
      await pool.request()
        .input("UserId", sql.Int, reactivatedBy || userId)
        .input("Action", sql.VarChar(100), "USER_REACTIVATED")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, userId)
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Reactivate User Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Ban user
  banUser: async (userId, reason = null, bannedBy = null, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          UPDATE Users
          SET IsBanned = 1,
              UpdatedAt = GETDATE()
          WHERE UserId = @UserId;
        `);
      
      // Create audit log
      await pool.request()
        .input("UserId", sql.Int, bannedBy)
        .input("Action", sql.VarChar(100), "USER_BANNED")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, userId)
        .input("NewValues", sql.NVarChar(sql.MAX), JSON.stringify({ reason }))
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, NewValues, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @NewValues, @IpAddress, @UserAgent);
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Ban User Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Unban user
  unbanUser: async (userId, unbannedBy = null, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          UPDATE Users
          SET IsBanned = 0,
              UpdatedAt = GETDATE()
          WHERE UserId = @UserId;
        `);
      
      // Create audit log
      await pool.request()
        .input("UserId", sql.Int, unbannedBy)
        .input("Action", sql.VarChar(100), "USER_UNBANNED")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, userId)
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @IpAddress, @UserAgent);
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Unban User Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Change user role
  changeUserRole: async (userId, newRole, changedBy = null, ipAddress = null, userAgent = null) => {
    try {
      const pool = await connectToDB();
      
      // Get old role for audit log
      const oldUser = await pool.request()
        .input("UserId", sql.Int, userId)
        .query("SELECT Role FROM Users WHERE UserId = @UserId");
      
      const oldRole = oldUser.recordset[0]?.Role;
      
      await pool.request()
        .input("UserId", sql.Int, userId)
        .input("Role", sql.VarChar(20), newRole)
        .query(`
          UPDATE Users
          SET Role = @Role,
              UpdatedAt = GETDATE()
          WHERE UserId = @UserId;
        `);
      
      // Create audit log
      await pool.request()
        .input("UserId", sql.Int, changedBy)
        .input("Action", sql.VarChar(100), "ROLE_CHANGED")
        .input("EntityType", sql.VarChar(50), "User")
        .input("EntityId", sql.Int, userId)
        .input("OldValues", sql.NVarChar(sql.MAX), JSON.stringify({ role: oldRole }))
        .input("NewValues", sql.NVarChar(sql.MAX), JSON.stringify({ role: newRole }))
        .input("IpAddress", sql.VarChar(45), ipAddress)
        .input("UserAgent", sql.VarChar(500), userAgent)
        .query(`
          INSERT INTO AuditLogs (UserId, Action, EntityType, EntityId, OldValues, NewValues, IpAddress, UserAgent)
          VALUES (@UserId, @Action, @EntityType, @EntityId, @OldValues, @NewValues, @IpAddress, @UserAgent);
        `);
      
      return { success: true };
    } catch (error) {
      console.error("❌ Change User Role Error:", error);
      return { success: false, error: error.message };
    }
  },

  // Check if username is available
  isUsernameAvailable: async (username, excludeUserId = null) => {
    try {
      const pool = await connectToDB();
      
      let query = `SELECT COUNT(*) as count FROM Users WHERE Username = @Username`;
      const request = pool.request()
        .input("Username", sql.VarChar(50), username);
      
      if (excludeUserId) {
        query += ` AND UserId != @ExcludeUserId`;
        request.input("ExcludeUserId", sql.Int, excludeUserId);
      }
      
      query += ` AND DeletedAt IS NULL`;
      
      const result = await request.query(query);
      return result.recordset[0].count === 0;
    } catch (error) {
      console.error("❌ Check Username Availability Error:", error);
      return false;
    }
  },

  // Check if email is available
  isEmailAvailable: async (email, excludeUserId = null) => {
    try {
      const pool = await connectToDB();
      
      let query = `SELECT COUNT(*) as count FROM Users WHERE Email = @Email`;
      const request = pool.request()
        .input("Email", sql.VarChar(150), email);
      
      if (excludeUserId) {
        query += ` AND UserId != @ExcludeUserId`;
        request.input("ExcludeUserId", sql.Int, excludeUserId);
      }
      
      query += ` AND DeletedAt IS NULL`;
      
      const result = await request.query(query);
      return result.recordset[0].count === 0;
    } catch (error) {
      console.error("❌ Check Email Availability Error:", error);
      return false;
    }
  },

  // Get all users with pagination
  getAllUsers: async (page = 1, limit = 20, filters = {}) => {
    try {
      const pool = await connectToDB();
      const offset = (page - 1) * limit;
      
      let whereClause = "WHERE u.DeletedAt IS NULL";
      const request = pool.request();
      
      if (filters.role) {
        whereClause += " AND u.Role = @Role";
        request.input("Role", sql.VarChar(20), filters.role);
      }
      
      if (filters.search) {
        whereClause += ` AND (u.Username LIKE '%' + @Search + '%' 
                         OR u.FullName LIKE '%' + @Search + '%'
                         OR u.Email LIKE '%' + @Search + '%')`;
        request.input("Search", sql.VarChar(150), filters.search);
      }
      
      if (filters.isActive !== undefined) {
        whereClause += " AND u.IsActive = @IsActive";
        request.input("IsActive", sql.Bit, filters.isActive);
      }
      
      if (filters.isBanned !== undefined) {
        whereClause += " AND u.IsBanned = @IsBanned";
        request.input("IsBanned", sql.Bit, filters.isBanned);
      }

      const result = await request.query(`
        SELECT 
          u.UserId, u.Username, u.FullName, u.Email, u.EmailVerified,
          u.Role, u.AvatarUrl, u.Bio, u.Location, u.Website,
          u.IsActive, u.IsBanned, u.LastLoginAt, u.CreatedAt, u.UpdatedAt,
          s.EmailNotifications, s.PushNotifications, s.PrivacyProfile
        FROM Users u
        LEFT JOIN UserSettings s ON u.UserId = s.UserId
        ${whereClause}
        ORDER BY u.CreatedAt DESC
        OFFSET ${offset} ROWS
        FETCH NEXT ${limit} ROWS ONLY;
      `);
      
      // Get total count
      const countResult = await pool.request().query(`
        SELECT COUNT(*) as total FROM Users u ${whereClause}
      `);
      
      return {
        users: result.recordset,
        pagination: {
          page,
          limit,
          total: countResult.recordset[0].total,
          totalPages: Math.ceil(countResult.recordset[0].total / limit)
        }
      };
    } catch (error) {
      console.error("❌ Get All Users Error:", error);
      return { users: [], pagination: { page, limit, total: 0, totalPages: 0 } };
    }
  },

  // Search users
  searchUsers: async (searchTerm, limit = 10) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("SearchTerm", sql.VarChar(150), `%${searchTerm}%`)
        .input("Limit", sql.Int, limit)
        .query(`
          SELECT TOP (@Limit)
            UserId, Username, FullName, Email, AvatarUrl, Bio,
            Location, Role, CreatedAt
          FROM Users
          WHERE (Username LIKE @SearchTerm 
                 OR FullName LIKE @SearchTerm 
                 OR Email LIKE @SearchTerm)
            AND DeletedAt IS NULL
            AND IsActive = 1
            AND IsBanned = 0
          ORDER BY 
            CASE 
              WHEN Username LIKE @SearchTerm THEN 1
              WHEN FullName LIKE @SearchTerm THEN 2
              WHEN Email LIKE @SearchTerm THEN 3
            END,
            CreatedAt DESC;
        `);
      
      return result.recordset;
    } catch (error) {
      console.error("❌ Search Users Error:", error);
      return [];
    }
  },

  // Get user statistics
  getUserStats: async (userId) => {
    try {
      const pool = await connectToDB();
      
      const result = await pool.request()
        .input("UserId", sql.Int, userId)
        .query(`
          SELECT 
            (SELECT COUNT(*) FROM Posts WHERE UserId = @UserId AND IsDeleted = 0) as PostCount,
            (SELECT COUNT(*) FROM PostLikes pl 
             JOIN Posts p ON pl.PostId = p.PostId 
             WHERE p.UserId = @UserId) as TotalLikes,
            (SELECT COUNT(*) FROM Follows WHERE FollowerId = @UserId) as FollowingCount,
            (SELECT COUNT(*) FROM Follows WHERE FollowingId = @UserId) as FollowersCount,
            (SELECT COUNT(*) FROM PostComments pc 
             JOIN Posts p ON pc.PostId = p.PostId 
             WHERE p.UserId = @UserId AND pc.IsDeleted = 0) as CommentsReceived;
        `);
      
      return result.recordset[0] || {
        PostCount: 0,
        TotalLikes: 0,
        FollowingCount: 0,
        FollowersCount: 0,
        CommentsReceived: 0
      };
    } catch (error) {
      console.error("❌ Get User Stats Error:", error);
      return {
        PostCount: 0,
        TotalLikes: 0,
        FollowingCount: 0,
        FollowersCount: 0,
        CommentsReceived: 0
      };
    }
  }
};

module.exports = User;