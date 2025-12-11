const jwt = require('jsonwebtoken');

const JWT_CONFIG = {
  secret: process.env.JWT_SECRET || 'your-secret-key-change-this-in-production',
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  algorithm: 'HS256'
};

const JwtService = {
  // Generate access token with sessionId
  generateAccessToken: (userId, username, role, sessionId) => {
    return jwt.sign(
      {
        userId,
        username,
        role,
        sessionId, // ✅ Include sessionId in JWT
        type: 'access'
      },
      JWT_CONFIG.secret,
      { 
        expiresIn: JWT_CONFIG.accessTokenExpiry,
        algorithm: JWT_CONFIG.algorithm
      }
    );
  },

  // Generate refresh token with sessionId
  generateRefreshToken: (userId, username, role, sessionId) => {
    return jwt.sign(
      {
        userId,
        username,
        role,
        sessionId, // ✅ Include sessionId in JWT
        type: 'refresh'
      },
      JWT_CONFIG.secret,
      { 
        expiresIn: JWT_CONFIG.refreshTokenExpiry,
        algorithm: JWT_CONFIG.algorithm
      }
    );
  },

  // Verify token
  verifyToken: (token) => {
    try {
      return jwt.verify(token, JWT_CONFIG.secret, { algorithms: [JWT_CONFIG.algorithm] });
    } catch (error) {
      console.error('JWT verification error:', error.message);
      return null;
    }
  },

  // Decode token without verification
  decodeToken: (token) => {
    try {
      return jwt.decode(token);
    } catch (error) {
      return null;
    }
  }
};

module.exports = { JWT_CONFIG, JwtService };