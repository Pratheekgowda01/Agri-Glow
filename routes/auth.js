
const express = require('express');
const multer = require('multer');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const mailerService = require('../services/mailer');
const smsService = require('../services/sms');
const {
  auth,
  authorize,
  adminOnly,
  farmerOnly,
  buyerOnly,
  farmerOrAdmin,
  buyerOrAdmin,
  authenticated
} = require('../middleware/auth');
const rateLimit = require('express-rate-limit');
const mapsService = require('../services/maps');

const router = express.Router();

// Multer config for profile image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../public/uploads/users'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, uniqueName);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB max
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed!'));
    }
    cb(null, true);
  }
});

// GET /api/users/profile - Get current user's profile
router.get('/users/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch profile', error: error.message });
  }
});

// Rate limiting for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 login requests per windowMs
  skipSuccessfulRequests: true,
  message: 'Too many login attempts, please try again later'
});

// Generate JWT token
const generateToken = (userId) => {
  return jwt.sign(
    { id: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

// Generate OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Store OTPs temporarily (in production, use Redis)
const otpStore = new Map();

// POST /api/auth/register (with profile image upload)
router.post('/register', authLimiter, upload.single('profileImage'), [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').matches(/^[\+]?[1-9][\d]{0,15}$/).withMessage('Valid phone number required'),
  body('role').isIn(['farmer', 'buyer']).withMessage('Role must be farmer or buyer'),
  body('address').trim().isLength({ min: 5 }).withMessage('Address is required'),
  body('city').trim().isLength({ min: 2 }).withMessage('City is required'),
  body('state').trim().isLength({ min: 2 }).withMessage('State is required'),
  body('pincode').matches(/^[0-9]{6}$/).withMessage('Valid 6-digit pincode required'),
  body('latitude').optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
  body('longitude').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      name,
      email,
      password,
      phone,
      role,
      address,
      city,
      state,
      pincode,
      latitude,
      longitude
    } = req.body;

    let profileImagePath = '';
    if (req.file) {
      profileImagePath = `/uploads/users/${req.file.filename}`;
    }

    const coordinatesProvided = latitude && longitude;

    const locationResult = coordinatesProvided
      ? { success: true, coordinates: [parseFloat(longitude), parseFloat(latitude)], formattedAddress: `${address}, ${city}, ${state} - ${pincode}` }
      : await mapsService.geocodeAddress(`${address}, ${city}, ${state} ${pincode}`);

    if (!locationResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to resolve location. Please adjust the address or map pin.'
      });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email 
          ? 'Email already registered' 
          : 'Phone number already registered'
      });
    }

    // Create user
    const user = new User({
      name,
      email,
      password,
      phone,
      role,
      location: {
        type: 'Point',
        coordinates: locationResult.coordinates,
        address: locationResult.formattedAddress || `${address}, ${city}, ${state} - ${pincode}`,
        city,
        state,
        pincode
      },
      profileImage: profileImagePath,
      verified: false
    });

    await user.save();

    // Send welcome email
    try {
      await mailerService.sendEmail('welcome', user.email, {
        name: user.name,
        role: user.role,
        year: new Date().getFullYear()
      });
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      // Don't return error to client, continue with registration
    }

    // Generate JWT token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email for further instructions.',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          verified: user.verified,
          location: user.location
        }
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/simple-register - Quick registration with basic info only
router.post('/simple-register', authLimiter, [
  body('name').trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').matches(/^[\+]?[1-9][\d]{0,15}$/).withMessage('Valid phone number required'),
  body('role').isIn(['farmer', 'buyer']).withMessage('Role must be farmer or buyer')
], async (req, res) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { name, email, password, phone, role } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: existingUser.email === email 
          ? 'Email already registered' 
          : 'Phone number already registered'
      });
    }

    // Create user with minimal required data - location will be updated later
    const user = new User({
      name,
      email,
      password,
      phone,
      role,
      location: {
        type: 'Point',
        coordinates: [77.2090, 28.6139], // Default Delhi coordinates
        address: 'To be updated from dashboard',
        city: 'To be updated',
        state: 'To be updated',
        pincode: '000000'
      },
      verified: false,
      profileComplete: false // Flag to indicate profile needs completion
    });

    await user.save();

    // Send welcome email
    try {
      await mailerService.sendEmail('welcome', user.email, {
        name: user.name,
        role: user.role,
        year: new Date().getFullYear()
      });
    } catch (error) {
      console.error('Failed to send welcome email:', error);
      // Don't return error to client, continue with registration
    }

    // Generate JWT token
    const token = generateToken(user._id);

    res.status(201).json({
      success: true,
      message: 'Registration successful! Please complete your profile from the dashboard.',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          verified: user.verified,
          profileComplete: user.profileComplete || false,
          location: user.location
        }
      }
    });

  } catch (error) {
    console.error('Simple registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/create-admin - Create admin account (secured)
router.post('/create-admin', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('adminKey').custom((value) => {
    if (value !== process.env.ADMIN_CREATE_KEY) {
      throw new Error('Invalid admin creation key');
    }
    return true;
  })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Check if admin already exists
    let admin = await User.findOne({ role: 'admin' });
    if (admin) {
      return res.status(400).json({
        success: false,
        message: 'Admin account already exists'
      });
    }

    // Create admin user
    admin = new User({
      name: 'System Admin',
      email,
      password,
      phone: '0000000000',
      role: 'admin',
      verified: true,
      isActive: true,
      location: {
        type: 'Point',
        coordinates: [0, 0],
        address: 'System',
        city: 'System',
        state: 'System',
        pincode: '000000'
      }
    });

    await admin.save();

    res.status(201).json({
      success: true,
      message: 'Admin account created successfully'
    });

  } catch (error) {
    console.error('Admin creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create admin account'
    });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, password, role } = req.body;

    // Find user and include password field
    const user = await User.findOne({ email }).select('+password');
    
    if (!user || !await user.comparePassword(password)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    // Verify role matches
    if (role && role.toLowerCase() !== user.role.toLowerCase()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid role for this account'
      });
    }

    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated. Please contact support.'
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    // Determine redirect URL based on role
    const userRole = user.role.toLowerCase();
    const redirectUrls = {
      farmer: '/farmer-dashboard.html',
      buyer: '/buyer-dashboard.html',
      admin: '/admin-dashboard.html'
    };

    if (!redirectUrls[userRole]) {
      console.error(`Invalid role for redirection: ${userRole}`);
    }

    const redirectUrl = redirectUrls[userRole] || '/';

    console.log('Login successful:', {
      userId: user._id,
      role: userRole,
      redirect: redirectUrl
    });

    const forwarded = req.headers['x-forwarded-for'];
    const loginIpSource = (Array.isArray(forwarded) ? forwarded[0] : forwarded) || req.socket?.remoteAddress || '';
    const loginIp = loginIpSource.split(',')[0].trim() || 'Unknown';
    const loginTime = new Date().toISOString();

    try {
      await mailerService.sendEmail('notification', user.email, {
        name: user.name,
        role: userRole,
        loginTime,
        ip: loginIp
      }, {
        category: 'notification',
        metadata: { userId: user._id, loginIp }
      });
    } catch (emailError) {
      console.error('Login alert email failed:', emailError);
    }

    res.json({
      success: true,
      status: 'success',
      message: 'Login successful',
      token: token,
      role: userRole,
      redirect: redirectUrl,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: userRole
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Login failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/verify
router.post('/verify', authLimiter, [
  body('userId').isMongoId().withMessage('Valid user ID required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('6-digit OTP required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId, otp } = req.body;
    const otpKey = `verify_${userId}`;
    
    const storedOtp = otpStore.get(otpKey);
    
    if (!storedOtp) {
      return res.status(400).json({
        success: false,
        message: 'OTP not found or expired'
      });
    }
    
    if (storedOtp.expires < Date.now()) {
      otpStore.delete(otpKey);
      return res.status(400).json({
        success: false,
        message: 'OTP expired'
      });
    }
    
    if (storedOtp.attempts >= 3) {
      otpStore.delete(otpKey);
      return res.status(400).json({
        success: false,
        message: 'Too many verification attempts'
      });
    }
    
    if (storedOtp.otp !== otp) {
      storedOtp.attempts++;
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Verify user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.verified = true;
    await user.save();

    // Clean up OTP
    otpStore.delete(otpKey);

    // Send welcome email
    try {
      await mailerService.sendEmail('welcome', user.email, {
        name: user.name,
        role: user.role
      }, {
        category: 'welcome',
        metadata: { userId: user._id }
      });
    } catch (emailError) {
      console.error('Welcome email failed:', emailError);
    }

    res.json({
      success: true,
      message: 'Account verified successfully',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          verified: user.verified
        }
      }
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Verification failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/resend-otp
router.post('/resend-otp', authLimiter, [
  body('userId').isMongoId().withMessage('Valid user ID required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId } = req.body;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (user.verified) {
      return res.status(400).json({
        success: false,
        message: 'Account already verified'
      });
    }

    // Generate new OTP
    const otp = generateOTP();
    const otpKey = `verify_${userId}`;
    
    otpStore.set(otpKey, {
      otp,
      expires: Date.now() + 10 * 60 * 1000, // 10 minutes
      attempts: 0
    });

    // Send new OTP via SMS
    try {
      await smsService.sendOTP(user.phone, otp, 'verification');
    } catch (smsError) {
      console.error('SMS resend failed:', smsError);
    }

    res.json({
      success: true,
      message: 'New OTP sent successfully'
    });

  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to resend OTP',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if email exists or not
      return res.json({
        success: true,
        message: 'If the email exists, reset instructions have been sent'
      });
    }

    // Generate reset OTP
    const otp = generateOTP();
    const otpKey = `reset_${user._id}`;
    
    otpStore.set(otpKey, {
      otp,
      expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      attempts: 0
    });

    // Send reset OTP via SMS
    try {
      await smsService.sendOTP(user.phone, otp, 'password_reset');
    } catch (smsError) {
      console.error('Password reset SMS failed:', smsError);
    }

    res.json({
      success: true,
      message: 'If the email exists, reset instructions have been sent',
      data: { userId: user._id } // Include userId for the reset process
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process password reset',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', authLimiter, [
  body('userId').isMongoId().withMessage('Valid user ID required'),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('6-digit OTP required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { userId, otp, newPassword } = req.body;
    const otpKey = `reset_${userId}`;
    
    const storedOtp = otpStore.get(otpKey);
    
    if (!storedOtp) {
      return res.status(400).json({
        success: false,
        message: 'OTP not found or expired'
      });
    }
    
    if (storedOtp.expires < Date.now()) {
      otpStore.delete(otpKey);
      return res.status(400).json({
        success: false,
        message: 'OTP expired'
      });
    }
    
    if (storedOtp.attempts >= 3) {
      otpStore.delete(otpKey);
      return res.status(400).json({
        success: false,
        message: 'Too many reset attempts'
      });
    }
    
    if (storedOtp.otp !== otp) {
      storedOtp.attempts++;
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Reset password
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.password = newPassword; // Will be hashed by pre-save middleware
    await user.save();

    // Clean up OTP
    otpStore.delete(otpKey);

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// GET /api/auth/me (Get current user info)
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('-password');
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          verified: user.verified,
          location: user.location,
          walletBalance: user.walletBalance,
          ratings: user.ratings,
          isActive: user.isActive,
          lastLogin: user.lastLogin,
          createdAt: user.createdAt,
          profileImage: user.profileImage,
          profileComplete: user.profileComplete
        }
      }
    });

  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user info',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/complete-profile - Complete profile after simple registration
router.post('/complete-profile', auth, [
  body('address').trim().isLength({ min: 5 }).withMessage('Address is required'),
  body('city').trim().isLength({ min: 2 }).withMessage('City is required'),
  body('state').trim().isLength({ min: 2 }).withMessage('State is required'),
  body('pincode').matches(/^[0-9]{6}$/).withMessage('Valid 6-digit pincode required'),
  body('latitude').optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
  body('longitude').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { address, city, state, pincode, latitude, longitude } = req.body;

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const coordinatesProvided = latitude && longitude;

    // Geocode address if coordinates not provided
    const locationResult = coordinatesProvided
      ? { success: true, coordinates: [parseFloat(longitude), parseFloat(latitude)], formattedAddress: `${address}, ${city}, ${state} - ${pincode}` }
      : await mapsService.geocodeAddress(`${address}, ${city}, ${state} ${pincode}`);

    if (!locationResult.success) {
      return res.status(400).json({
        success: false,
        message: 'Unable to resolve location. Please check the address or provide coordinates.'
      });
    }

    // Update user profile with complete information
    user.location = {
      type: 'Point',
      coordinates: locationResult.coordinates,
      address: locationResult.formattedAddress || `${address}, ${city}, ${state} - ${pincode}`,
      city,
      state,
      pincode
    };
    user.profileComplete = true;

    await user.save();

    res.json({
      success: true,
      message: 'Profile completed successfully!',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          verified: user.verified,
          profileComplete: user.profileComplete,
          location: user.location
        }
      }
    });

  } catch (error) {
    console.error('Profile completion error:', error);
    res.status(500).json({
      success: false,
      message: 'Profile completion failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// PUT /api/auth/profile (Update profile)
router.put('/profile', auth, [
  body('name').optional().trim().isLength({ min: 2, max: 50 }).withMessage('Name must be 2-50 characters'),
  body('phone').optional().matches(/^[\+]?[1-9][\d]{0,15}$/).withMessage('Valid phone number required'),
  body('address').optional().trim().isLength({ min: 5 }).withMessage('Address must be at least 5 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Update allowed fields
    const allowedUpdates = ['name', 'phone'];
    const updates = {};
    
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    if (req.body.address && req.body.city && req.body.state && req.body.pincode) {
      updates.location = {
        ...user.location,
        address: `${req.body.address}, ${req.body.city}, ${req.body.state} - ${req.body.pincode}`,
        city: req.body.city,
        state: req.body.state,
        pincode: req.body.pincode
      };
    }

    Object.assign(user, updates);
    await user.save();

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          verified: user.verified,
          location: user.location,
          walletBalance: user.walletBalance,
          ratings: user.ratings
        }
      }
    });

  } catch (error) {
    console.error('Profile update error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already in use'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Profile update failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res) => {
  try {
    // In a stateless JWT system, logout is handled client-side
    // But we can update the last login time
    await User.findByIdAndUpdate(req.userId, {
      lastLogin: new Date()
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// PUT /api/auth/status - Toggle user active status
router.put('/status', auth, [
  body('isActive').isBoolean().withMessage('Status must be true or false')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const user = await User.findByIdAndUpdate(
      req.userId, 
      { isActive: req.body.isActive },
      { new: true, select: '-password' }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: `Account status updated to ${req.body.isActive ? 'active' : 'inactive'}`,
      data: {
        isActive: user.isActive
      }
    });

  } catch (error) {
    console.error('Status update error:', error);
    res.status(500).json({
      success: false,
      message: 'Status update failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// GET /api/auth/check
router.get('/check', auth, async (req, res) => {
  try {
    // Since auth middleware already verified the token and user,
    // we just need to send a success response with user data
    res.json({
      success: true,
      message: 'Token is valid',
      data: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        redirect: `${process.env.BASE_URL || 'http://localhost:3000'}/${req.user.role.toLowerCase()}-dashboard.html`
      }
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({
      success: false,
      message: 'Auth check failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error'
    });
  }
});

// POST /api/auth/forgot-password - Request password reset
router.post('/forgot-password', authLimiter, [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal if email exists - security best practice
      return res.json({
        success: true,
        message: 'If an account exists with this email, a reset link has been sent.'
      });
    }

    // Generate OTP (6 digits)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 30 * 60 * 1000; // 30 minutes

    // Save OTP to user
    user.resetOTP = otp;
    user.resetOTPExpires = otpExpires;
    await user.save();

    // Send OTP via email
    try {
      await mailerService.sendEmail('password_reset', user.email, {
        name: user.name,
        otp: otp
      });
    } catch (emailError) {
      console.error('Failed to send password reset email:', emailError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send reset email. Please try again.'
      });
    }

    res.json({
      success: true,
      message: 'Password reset OTP sent to your email'
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error processing password reset request',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/auth/verify-reset-token - Verify OTP
router.post('/verify-reset-token', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('otp').isLength({ min: 4, max: 6 }).withMessage('Valid OTP required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, otp } = req.body;

    const user = await User.findOne({ 
      email,
      resetOTP: otp,
      resetOTPExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP'
      });
    }

    // Generate temporary reset token
    const resetToken = jwt.sign(
      { id: user._id, email: user.email, purpose: 'password-reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      success: true,
      message: 'OTP verified successfully',
      token: resetToken
    });
  } catch (error) {
    console.error('Verify reset token error:', error);
    res.status(500).json({
      success: false,
      message: 'Token verification failed'
    });
  }
});

// POST /api/auth/reset-password - Reset password with token
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('token').notEmpty().withMessage('Reset token required'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { email, token, newPassword } = req.body;

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    if (decoded.purpose !== 'password-reset' || decoded.email !== email) {
      return res.status(400).json({
        success: false,
        message: 'Invalid reset token'
      });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset tokens
    user.password = hashedPassword;
    user.resetOTP = undefined;
    user.resetOTPExpires = undefined;
    await user.save();

    // Send confirmation email
    try {
      await mailerService.sendEmail('welcome', user.email, {
        name: user.name,
        message: 'Your password has been successfully reset.'
      });
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
    }

    res.json({
      success: true,
      message: 'Password reset successfully. Please login with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Password reset failed',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;