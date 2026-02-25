const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const mailerService = require('../services/mailer');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate limiting for login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login requests per windowMs
  message: 'Too many login attempts, please try again later'
});

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
};

// POST /api/auth/login
router.post('/login', loginLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  body('role').isIn(['farmer', 'buyer', 'admin']).withMessage('Valid role required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password, role } = req.body;

    // Find user and include password field
    const user = await User.findOne({ email, role }).select('+password');
    
    if (!user || !await user.comparePassword(password)) {
      return res.status(401).json({
        status: 'error',
        message: 'Invalid email, password, or role'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        status: 'error',
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Determine redirect URL based on role
    const redirectUrls = {
      farmer: '/farmer-dashboard.html',
      buyer: '/buyer-dashboard.html',
      admin: '/admin-dashboard.html'
    };

    // Send login alert email
    try {
      await mailerService.sendEmail('login_alert', user.email, {
        name: user.name,
        role: user.role,
        loginTime: new Date().toLocaleString(),
        ip: req.ip
      });
    } catch (error) {
      console.error('Failed to send login alert:', error);
    }

    res.json({
      status: 'success',
      message: 'Login successful',
      token,
      role: user.role,
      redirect: redirectUrls[user.role.toLowerCase()],
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      status: 'error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

module.exports = router;