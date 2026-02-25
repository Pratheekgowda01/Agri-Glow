require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const path = require('path');
const socketService = require('./services/socket');
const winston = require('winston');
const multer = require('multer');

// Import routes
const authRoutes = require('./routes/auth');
const authCheckRoutes = require('./routes/auth-check');
const productRoutes = require('./routes/products');
const testRoutes = require('./routes/test');
const farmerRoutes = require('./routes/farmer');
const buyerRoutes = require('./routes/buyer');
const adminRoutes = require('./routes/admin');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Initialize Socket.IO
socketService.initialize(server);

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'agri-glow' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later',
  standardHeaders: true,
  legacyHeaders: false
});

app.use(generalLimiter);

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? process.env.FRONTEND_URL?.split(',') || [] 
    : ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.version
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', authCheckRoutes);
app.use('/api/products', productRoutes);
app.use('/api/test', testRoutes);
app.use('/api/farmer', farmerRoutes);
app.use('/api/buyer', buyerRoutes);
app.use('/api/admin', adminRoutes);
// Maps and chat routes
const mapsRoutes = require('./routes/maps');
const chatRoutes = require('./routes/chat');
app.use('/api/maps', mapsRoutes);
app.use('/api/chat', chatRoutes);

// Serve HTML files for different dashboards
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});



app.get('/farmer-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'farmer-dashboard.html'));
});

app.get('/buyer-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'buyer-dashboard.html'));
});

app.get('/admin-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-dashboard.html'));
});

app.get('/config/maps', (req, res) => {
  res.json({
    osmTileUrl: process.env.OSM_TILE_URL,
    nominatimUrl: process.env.NOMINATIM_URL,
    osrmRouteUrl: process.env.OSRM_ROUTE_URL
  });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip
  });

  // Multer errors
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large. Maximum size is 5MB.'
      });
    }
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Validation error',
      errors: Object.values(err.errors).map(e => e.message)
    });
  }

  // MongoDB errors
  if (err.name === 'MongoError' || err.name === 'MongoServerError') {
    if (err.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Duplicate entry. Resource already exists.'
      });
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Authentication token expired'
    });
  }

  // Default error response
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong!' 
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Handle 404 errors
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Database connection
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10, // Maintain up to 10 socket connections
      serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
      socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
      family: 4 // Use IPv4, skip trying IPv6
    });

    logger.info(`MongoDB connected: ${conn.connection.host}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
    });

  } catch (error) {
    logger.error('Database connection failed:', error);
    process.exit(1);
  }
};

// Graceful shutdown handler
const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, shutting down gracefully`);
  
  // Set a timeout to force-close if graceful shutdown takes too long
  const forceClose = setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
  
  // Close server first (stop accepting new connections)
  server.close(async () => {
    try {
      logger.info('Server closed, closing database connection');
      await mongoose.connection.close(false);
      logger.info('MongoDB connection closed');
      
      // Clear the force-close timeout since we shut down gracefully
      clearTimeout(forceClose);
      process.exit(0);
    } catch (err) {
      logger.error('Error during graceful shutdown:', err);
      process.exit(1);
    }
  });
};

// Handle graceful shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception:', { error: err.message, stack: err.stack });
  // Give the process a chance to finish logging before exiting
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { 
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined
  });
  // Don't exit for unhandled rejections, just log them
});

// Start server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    // Connect to database first
    await connectDB();
    
    // Create necessary directories
    const fs = require('fs').promises;
    const directories = [
      'logs',
      'public/uploads/products',
      'public/uploads/users',
      'public/uploads/chat'
    ];
    
    for (const dir of directories) {
      try {
        await fs.access(dir);
      } catch {
        await fs.mkdir(dir, { recursive: true });
        logger.info(`Created directory: ${dir}`);
      }
    }
    
    // Start server
    server.listen(PORT, () => {
      logger.info(`
╔══════════════════════════════════════════════╗
║              🌱 AGRI GLOW 🌱                  ║
║        Digital Marketplace Platform          ║
╠══════════════════════════════════════════════╣
║  Server running on: http://localhost:${PORT.toString().padEnd(4)} ║
║  Environment: ${process.env.NODE_ENV?.padEnd(11) || 'development'.padEnd(11)} ║
║  Database: Connected                         ║
║  Socket.IO: Initialized                      ║
╚══════════════════════════════════════════════╝
      `);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server };