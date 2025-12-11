const User = require('../models/users');
const Session = require('../models/session');
const AuditLog = require('../models/auditLog');
const RateLimitLog = require('../models/rateLimitLog');
const { JwtService } = require('../config/jwt');
const { upload: profileUpload, ProfileMediaHelper } = require('../config/userprofilemulter');
const path  = require('path');


const AuthController = {
  // Register new user
  register: async (req, res) => {
    try {
      const { username, email, password, fullName, role } = req.body;
      
      // Validation
      if (!username || !email || !password || !fullName) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields'
        });
      }
      
      // Email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid email format'
        });
      }
      
      // Password strength validation
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 8 characters long'
        });
      }
      
      // Check rate limiting
      const ipAddress = req.ip;
      const requestCount = await RateLimitLog.getRequestCount(ipAddress, null, '/api/auth/register', 60);
      
      if (requestCount > 10) {
        return res.status(429).json({
          success: false,
          error: 'Too many registration attempts. Please try again later.'
        });
      }
      
      // Log request
      await RateLimitLog.logRequest({
        userId: null,
        ipAddress,
        userAgent: req.get('User-Agent'),
        endpoint: '/api/auth/register',
        method: 'POST',
        statusCode: 200
      });
      
      // Create user
      const result = await User.createUser(
        { username, email, password, fullName, role },
        ipAddress,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      // Generate tokens
      const accessToken = JwtService.generateAccessToken(
        result.user.userId,
        result.user.username,
        result.user.role
      );
      
      const refreshToken = JwtService.generateRefreshToken(
        result.user.userId,
        result.user.username,
        result.user.role
      );
      
      // Create session
      await Session.createSession(
        result.user.userId,
        req.get('User-Agent'),
        ipAddress,
        req.get('User-Agent')
      );
      
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        data: {
          user: result.user,
          tokens: {
            accessToken,
            refreshToken,
            expiresIn: 15 * 60 // 15 minutes in seconds
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Registration Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Login user
 login: async (req, res) => {
    try {
      const { username, password } = req.body;
      
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: 'Username and password are required'
        });
      }
      
      const ipAddress = req.ip;
      const userAgent = req.get('User-Agent');
      
      // Authenticate user
      const result = await User.authenticateUser(username, password, ipAddress, userAgent);
      
      if (!result.success) {
        return res.status(401).json({
          success: false,
          error: result.error,
          code: result.code,
          attempts: result.attempts,
          locked: result.locked
        });
      }
      
      // Create session first
      const sessionResult = await Session.createSession(
        result.user.UserId,
        userAgent,
        ipAddress,
        userAgent
      );
      
      if (!sessionResult.success) {
        return res.status(500).json({
          success: false,
          error: 'Failed to create session'
        });
      }
      
      // Generate tokens with sessionId
      const accessToken = JwtService.generateAccessToken(
        result.user.UserId,
        result.user.Username,
        result.user.Role,
        sessionResult.sessionId // ✅ Pass sessionId to token
      );
      
      const refreshToken = JwtService.generateRefreshToken(
        result.user.UserId,
        result.user.Username,
        result.user.Role,
        sessionResult.sessionId // ✅ Pass sessionId to token
      );
      
      res.json({
        success: true,
        message: 'Login successful',
        data: {
          user: result.user,
          tokens: {
            accessToken,
            refreshToken,
            expiresIn: 15 * 60 // 15 minutes in seconds
          },
          sessionId: sessionResult.sessionId
        }
      });
      
    } catch (error) {
      console.error('❌ Login Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Refresh token
  refreshToken: async (req, res) => {
    try {
      const { refreshToken: oldRefreshToken } = req.body;
      
      if (!oldRefreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token is required'
        });
      }
      
      // Verify refresh token
      const decoded = JwtService.verifyToken(oldRefreshToken);
      
      if (!decoded || decoded.type !== 'refresh') {
        return res.status(401).json({
          success: false,
          error: 'Invalid refresh token'
        });
      }
      
      // Check if session exists and is valid
      const session = await Session.getSessionById(decoded.sessionId);
      
      if (!session || !session.IsActive) {
        return res.status(401).json({
          success: false,
          error: 'Session expired or invalid'
        });
      }
      
      // Check if user exists and is active
      const user = await User.getUserById(decoded.userId);
      
      if (!user || !user.IsActive || user.IsBanned) {
        return res.status(401).json({
          success: false,
          error: 'User account is inactive or banned'
        });
      }
      
      // Update session activity
      await Session.updateSessionActivity(decoded.sessionId);
      
      // Generate new tokens with same sessionId
      const newAccessToken = JwtService.generateAccessToken(
        user.UserId,
        user.Username,
        user.Role,
        decoded.sessionId
      );
      
      const newRefreshToken = JwtService.generateRefreshToken(
        user.UserId,
        user.Username,
        user.Role,
        decoded.sessionId
      );
      
      res.json({
        success: true,
        data: {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: 15 * 60
        }
      });
      
    } catch (error) {
      console.error('❌ Refresh Token Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },
  // Logout
  logout: async (req, res) => {
    try {
      const { sessionId } = req.body;
      const userId = req.user?.userId;
      
      if (sessionId) {
        // Revoke specific session
        await Session.revokeSession(
          sessionId,
          userId,
          req.ip,
          req.get('User-Agent')
        );
      } else if (userId) {
        // Revoke all sessions for user
        await Session.revokeAllUserSessions(
          userId,
          null,
          userId,
          req.ip,
          req.get('User-Agent')
        );
      }
      
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
      
    } catch (error) {
      console.error('❌ Logout Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Get current user profile
   getProfile: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const user = await User.getUserById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
      
      // Don't send sensitive data
      const safeUser = {
        UserId: user.UserId,
        Username: user.Username,
        Email: user.Email,
        FullName: user.FullName,
        Role: user.Role,
        avatar: user.avatar,
        IsVerified: user.IsVerified,
        CreatedAt: user.CreatedAt,
        Settings: user.Settings
      };
      
      res.json({
        success: true,
        data: safeUser
      });
      
    } catch (error) {
      console.error('❌ Get Profile Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },
 updateProfile: async (req, res) => {
    try {
      const userId = req.user.userId;
      const updateData = {};
      
      // Handle text fields
      if (req.body.fullName !== undefined) updateData.fullName = req.body.fullName;
      if (req.body.bio !== undefined) updateData.bio = req.body.bio;
      if (req.body.location !== undefined) updateData.location = req.body.location;
      if (req.body.website !== undefined) updateData.website = req.body.website;
      
      // Handle file uploads if present
      if (req.files) {
        // Handle avatar upload
        if (req.files.avatar && req.files.avatar[0]) {
          const avatarFile = req.files.avatar[0];
          // Store filename only, not full path
          updateData.avatarUrl = `/uploads/profiles/${avatarFile.filename}`;
        }
        
        // Handle cover upload
        if (req.files.cover && req.files.cover[0]) {
          const coverFile = req.files.cover[0];
          // Store filename only, not full path
          updateData.coverImage = `/uploads/profiles/${coverFile.filename}`;
        }
      }
      
      // If no data to update
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({
          success: false,
          error: "No fields to update"
        });
      }
      
      const result = await User.updateProfile(
        userId,
        updateData,
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error || 'Failed to update profile'
        });
      }
      
      // Get updated user
      const updatedUser = await User.getUserById(userId);
      
      res.json({
        success: true,
        message: 'Profile updated successfully',
        data: {
          UserId: updatedUser.UserId,
          Username: updatedUser.Username,
          Email: updatedUser.Email,
          FullName: updatedUser.FullName,
          Bio: updatedUser.Bio,
          Location: updatedUser.Location,
          Website: updatedUser.Website,
          AvatarUrl: updatedUser.AvatarUrl,
          CoverImage: updatedUser.CoverImage,
          Role: updatedUser.Role,
          IsVerified: updatedUser.IsVerified,
          CreatedAt: updatedUser.CreatedAt
        }
      });
      
    } catch (error) {
      console.error('❌ Update Profile Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Separate endpoint for avatar upload only
  uploadAvatar: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }
      
      // Delete old avatar
      await ProfileMediaHelper.deleteOldProfileFile(userId, 'avatar');
      
      // Create relative path for database
      const avatarPath = `/uploads/profiles/${path.basename(req.file.path)}`;
      
      const result = await User.updateProfile(
        userId,
        { avatar: avatarPath },
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        ProfileMediaHelper.deleteFile(req.file.path);
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Avatar uploaded successfully',
        data: {
          avatarUrl: avatarPath
        }
      });
      
    } catch (error) {
      console.error('❌ Upload Avatar Error:', error);
      if (req.file) {
        ProfileMediaHelper.deleteFile(req.file.path);
      }
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Separate endpoint for cover upload only
  uploadCover: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded'
        });
      }
      
      // Delete old cover
      await ProfileMediaHelper.deleteOldProfileFile(userId, 'coverImage');
      
      // Create relative path for database
      const coverPath = `/uploads/profiles/${path.basename(req.file.path)}`;
      
      const result = await User.updateProfile(
        userId,
        { coverImage: coverPath },
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        ProfileMediaHelper.deleteFile(req.file.path);
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Cover image uploaded successfully',
        data: {
          coverUrl: coverPath
        }
      });
      
    } catch (error) {
      console.error('❌ Upload Cover Error:', error);
      if (req.file) {
        ProfileMediaHelper.deleteFile(req.file.path);
      }
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Remove avatar
  removeAvatar: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const user = await User.getUserById(userId);
      
      if (user && user.avatar) {
        const oldFilePath = path.join(__dirname, '..', user.avatar);
        ProfileMediaHelper.deleteFile(oldFilePath);
      }
      
      const result = await User.updateProfile(
        userId,
        { avatar: null },
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Avatar removed successfully'
      });
      
    } catch (error) {
      console.error('❌ Remove Avatar Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Remove cover
  removeCover: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const user = await User.getUserById(userId);
      
      if (user && user.coverImage) {
        const oldFilePath = path.join(__dirname, '..', user.coverImage);
        ProfileMediaHelper.deleteFile(oldFilePath);
      }
      
      const result = await User.updateProfile(
        userId,
        { coverImage: null },
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Cover image removed successfully'
      });
      
    } catch (error) {
      console.error('❌ Remove Cover Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Change password
  changePassword: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { currentPassword, newPassword } = req.body;
      
      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: 'Current password and new password are required'
        });
      }
      
      if (newPassword.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'New password must be at least 8 characters long'
        });
      }
      
      const result = await User.updatePassword(
        userId,
        currentPassword,
        newPassword,
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Password changed successfully'
      });
      
    } catch (error) {
      console.error('❌ Change Password Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Update user settings
  updateSettings: async (req, res) => {
    try {
      const userId = req.user.userId;
      const settings = req.body;
      
      const result = await User.updateUserSettings(
        userId,
        settings,
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Settings updated successfully'
      });
      
    } catch (error) {
      console.error('❌ Update Settings Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Get user sessions
  getSessions: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const sessions = await Session.getUserSessions(userId);
      
      res.json({
        success: true,
        data: sessions
      });
      
    } catch (error) {
      console.error('❌ Get Sessions Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Revoke session
  revokeSession: async (req, res) => {
    try {
      const userId = req.user.userId;
      const { sessionId } = req.params;
      
      const result = await Session.revokeSession(
        sessionId,
        userId,
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Session revoked successfully'
      });
      
    } catch (error) {
      console.error('❌ Revoke Session Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Verify email
  verifyEmail: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const result = await User.updateEmailVerification(
        userId,
        true,
        req.ip,
        req.get('User-Agent')
      );
      
      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error
        });
      }
      
      res.json({
        success: true,
        message: 'Email verified successfully'
      });
      
    } catch (error) {
      console.error('❌ Verify Email Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },

  // Check username availability
  checkUsernameAvailability: async (req, res) => {
    try {
      const { username } = req.params;
      const userId = req.user?.userId;
      
      if (!username) {
        return res.status(400).json({
          success: false,
          error: 'Username is required'
        });
      }
      
      const isAvailable = await User.isUsernameAvailable(username, userId);
      
      res.json({
        success: true,
        data: {
          username,
          available: isAvailable
        }
      });
      
    } catch (error) {
      console.error('❌ Check Username Availability Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  },
  // --------------------------------------
// Get user suggestions
// --------------------------------------
getUserSuggestions: async (req, res) => {
  try {
    const userId = req.user.userId;
    const limit = parseInt(req.query.limit) || 5;

    const suggestions = await User.getUserSuggestions(userId, limit);

    res.json({
      success: true,
      data: suggestions
    });

  } catch (error) {
    console.error("❌ Get User Suggestions Error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
},


  // Check email availability
  checkEmailAvailability: async (req, res) => {
    try {
      const { email } = req.params;
      const userId = req.user?.userId;
      
      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
        });
      }
      
      const isAvailable = await User.isEmailAvailable(email, userId);
      
      res.json({
        success: true,
        data: {
          email,
          available: isAvailable
        }
      });
      
    } catch (error) {
      console.error('❌ Check Email Availability Error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
};

module.exports = AuthController;