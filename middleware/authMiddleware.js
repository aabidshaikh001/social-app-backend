const { JwtService } = require('../config/jwt');
const Session = require('../models/session');
const RateLimitLog = require('../models/rateLimitLog');

// Authentication middleware
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Access token is required'
      });
    }
    
    const token = authHeader.split(' ')[1];
    
    // Verify token
    const decoded = JwtService.verifyToken(token);
    
    if (!decoded || decoded.type !== 'access') {
      return res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    
    // Check session exists and is active
    const session = await Session.getSessionById(decoded.sessionId);
    
    if (!session) {
      return res.status(401).json({
        success: false,
        error: 'Session not found'
      });
    }
    
    if (!session.IsActive) {
      return res.status(401).json({
        success: false,
        error: 'Session expired'
      });
    }
    
    // Update session activity
    await Session.updateSessionActivity(decoded.sessionId);
    
    // Attach user to request
    req.user = {
      userId: decoded.userId,
      username: decoded.username,
      role: decoded.role,
      sessionId: decoded.sessionId
    };
    
    next();
  } catch (error) {
    console.error('❌ Authentication Error:', error.message);
    res.status(401).json({
      success: false,
      error: 'Authentication failed'
    });
  }
};

// Role-based authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions'
      });
    }
    
    next();
  };
};

// Rate limiting middleware
const rateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    maxRequests = 100,
    message = 'Too many requests, please try again later.'
  } = options;
  
  return async (req, res, next) => {
    try {
      const ipAddress = req.ip;
      const userId = req.user?.userId;
      const endpoint = req.originalUrl;
      
      // Calculate time window in minutes
      const windowMinutes = windowMs / (60 * 1000);
      
      // Get request count
      const requestCount = await RateLimitLog.getRequestCount(
        ipAddress,
        userId,
        endpoint,
        windowMinutes
      );
      
      // Check if limit exceeded
      if (requestCount >= maxRequests) {
        // Log the blocked request
        await RateLimitLog.logRequest({
          userId,
          ipAddress,
          userAgent: req.get('User-Agent'),
          endpoint,
          method: req.method,
          statusCode: 429
        });
        
        return res.status(429).json({
          success: false,
          error: message,
          retryAfter: Math.ceil(windowMs / 1000)
        });
      }
      
      // Add headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': maxRequests - requestCount - 1,
        'X-RateLimit-Reset': new Date(Date.now() + windowMs).toISOString()
      });
      
      next();
    } catch (error) {
      console.error('❌ Rate Limiter Error:', error);
      // Don't block requests if rate limiting fails
      next();
    }
  };
};

// Request logging middleware
const requestLogger = async (req, res, next) => {
  const startTime = Date.now();
  
  // Log response
  const originalSend = res.send;
  res.send = function(data) {
    const responseTime = Date.now() - startTime;
    
    // Log the request (async, don't wait)
    RateLimitLog.logRequest({
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      endpoint: req.originalUrl,
      method: req.method,
      statusCode: res.statusCode,
      requestSize: req.headers['content-length'] ? parseInt(req.headers['content-length']) : null,
      responseTime
    }).catch(err => console.error('Failed to log request:', err));
    
    return originalSend.call(this, data);
  };
  
  next();
};

module.exports = {
  authenticate,
  authorize,
  rateLimiter,
  requestLogger
};