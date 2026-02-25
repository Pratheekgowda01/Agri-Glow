const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // No demo bypasses in production

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token. User not found.'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated.'
      });
    }

    // Add user info to request object
    req.userId = user._id;
    req.userRole = user.role;
    req.user = user;

    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired.'
      });
    }

    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during authentication'
    });
  }
};

// Role-based authorization middleware
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
    }
    next();
  };
};

// Check if user is verified
const requireVerified = (req, res, next) => {
  if (!req.user.verified) {
    return res.status(403).json({
      success: false,
      message: 'Please verify your account to access this feature.'
    });
  }
  next();
};

// Admin only access
const adminOnly = [auth, authorize('admin')];

// Farmer only access
const farmerOnly = [auth, authorize('farmer')];

// Buyer only access
const buyerOnly = [auth, authorize('buyer')];

// Farmer or admin access
const farmerOrAdmin = [auth, authorize('farmer', 'admin')];

// Buyer or admin access
const buyerOrAdmin = [auth, authorize('buyer', 'admin')];

// Any authenticated user
const authenticated = [auth];

// Verified user only
const verifiedUser = [auth, requireVerified];

module.exports = {
  auth,
  authorize,
  requireVerified,
  adminOnly,
  farmerOnly,
  buyerOnly,
  farmerOrAdmin,
  buyerOrAdmin,
  authenticated,
  verifiedUser
};