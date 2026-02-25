const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { Message, Conversation } = require('../models/Chat');
const winston = require('winston');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/socket-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/socket-combined.log' })
  ]
});

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // userId -> socketId mapping
    this.userSockets = new Map();    // socketId -> user data mapping
    this.activeRooms = new Map();    // conversationId -> Set of participant socketIds
  }

  // Initialize Socket.IO server
  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: process.env.NODE_ENV === 'production' 
          ? process.env.FRONTEND_URL 
          : "http://localhost:3000",
        methods: ["GET", "POST"],
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
          return next(new Error('Authentication token missing'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);
        
        if (!user || !user.isActive) {
          return next(new Error('Invalid user or account inactive'));
        }

        socket.userId = user._id.toString();
        socket.userRole = user.role;
        socket.userData = {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role
        };

        next();
      } catch (error) {
        logger.error('Socket authentication failed:', error);
        next(new Error('Authentication failed'));
      }
    });

    // Handle connections
    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    logger.info('Socket.IO server initialized');
    return this.io;
  }

  // Handle new socket connection
  handleConnection(socket) {
    const userId = socket.userId;
    
    // Store user connection
    this.connectedUsers.set(userId, socket.id);
    this.userSockets.set(socket.id, socket.userData);
    
    // Join user to their personal room
    socket.join(`user_${userId}`);
    
    // Join role-based rooms
    socket.join(`role_${socket.userRole}`);
    
    logger.info(`User ${socket.userData.name} (${userId}) connected`, {
      socketId: socket.id,
      role: socket.userRole
    });

    // Send connection confirmation
    socket.emit('connected', {
      message: 'Connected successfully',
      userId: userId,
      role: socket.userRole
    });

    // Handle real-time events
    this.setupEventHandlers(socket);

    // Handle disconnection
    socket.on('disconnect', () => {
      this.handleDisconnection(socket);
    });
  }

  // Setup event handlers for socket
  setupEventHandlers(socket) {
    const userId = socket.userId;
    const userRole = socket.userRole;

    // Join product-specific rooms for real-time updates
    socket.on('join_product', (productId) => {
      socket.join(`product_${productId}`);
      logger.info(`User ${userId} joined product room: ${productId}`);
    });

    socket.on('leave_product', (productId) => {
      socket.leave(`product_${productId}`);
      logger.info(`User ${userId} left product room: ${productId}`);
    });

    // Join order-specific rooms
    socket.on('join_order', (orderId) => {
      socket.join(`order_${orderId}`);
      logger.info(`User ${userId} joined order room: ${orderId}`);
    });

    socket.on('leave_order', (orderId) => {
      socket.leave(`order_${orderId}`);
      logger.info(`User ${userId} left order room: ${orderId}`);
    });

    // Handle farmer-specific events
    if (userRole === 'farmer') {
      socket.on('toggle_product', async (data) => {
        try {
          // Emit to all users viewing this product
          socket.to(`product_${data.productId}`).emit('product_updated', {
            productId: data.productId,
            isActive: data.isActive,
            farmerId: userId,
            timestamp: new Date()
          });
          
          logger.info(`Product ${data.productId} toggled by farmer ${userId}`, data);
        } catch (error) {
          logger.error('Error handling product toggle:', error);
          socket.emit('error', { message: 'Failed to update product status' });
        }
      });

      socket.on('update_stock', async (data) => {
        try {
          // Emit stock update to all interested parties
          socket.to(`product_${data.productId}`).emit('stock_updated', {
            productId: data.productId,
            newQuantity: data.quantity,
            farmerId: userId,
            timestamp: new Date()
          });
          
          logger.info(`Stock updated for product ${data.productId}`, data);
        } catch (error) {
          logger.error('Error handling stock update:', error);
          socket.emit('error', { message: 'Failed to update stock' });
        }
      });
    }

    // Handle buyer-specific events
    if (userRole === 'buyer') {
      socket.on('track_order', (orderId) => {
        socket.join(`order_${orderId}`);
        logger.info(`Buyer ${userId} tracking order: ${orderId}`);
      });
    }

    // Handle admin-specific events
    if (userRole === 'admin') {
      socket.join('admin_room');
      
      socket.on('broadcast_announcement', (data) => {
        try {
          this.io.emit('admin_announcement', {
            message: data.message,
            type: data.type || 'info',
            timestamp: new Date()
          });
          
          logger.info(`Admin ${userId} broadcasted announcement: ${data.message}`);
        } catch (error) {
          logger.error('Error broadcasting announcement:', error);
        }
      });
    }

    // Handle typing indicators for chat
    socket.on('typing_start', (data) => {
      socket.to(`order_${data.orderId}`).emit('user_typing', {
        userId: userId,
        userName: socket.userData.name,
        orderId: data.orderId
      });
    });

    socket.on('typing_stop', (data) => {
      socket.to(`order_${data.orderId}`).emit('user_stop_typing', {
        userId: userId,
        orderId: data.orderId
      });
    });

    // Handle real-time messages
    socket.on('send_message', (data) => {
      try {
        const messageData = {
          ...data,
          senderId: userId,
          senderName: socket.userData.name,
          timestamp: new Date()
        };
        
        // Send to specific room (order or product)
        if (data.orderId) {
          socket.to(`order_${data.orderId}`).emit('new_message', messageData);
        }
        
        logger.info(`Message sent by ${userId}`, messageData);
      } catch (error) {
        logger.error('Error handling message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Handle location updates for delivery tracking
    socket.on('location_update', (data) => {
      try {
        if (data.orderId) {
          socket.to(`order_${data.orderId}`).emit('delivery_location_update', {
            orderId: data.orderId,
            location: data.location,
            timestamp: new Date()
          });
        }
        
        logger.info(`Location update from ${userId}`, data);
      } catch (error) {
        logger.error('Error handling location update:', error);
      }
    });
  }

  // Handle socket disconnection
  handleDisconnection(socket) {
    const userId = socket.userId;
    const userData = this.userSockets.get(socket.id);
    
    // Remove from tracking maps
    this.connectedUsers.delete(userId);
    this.userSockets.delete(socket.id);
    
    logger.info(`User ${userData?.name} (${userId}) disconnected`, {
      socketId: socket.id
    });
  }

  // Send notification to specific user
  async sendToUser(userId, event, data) {
    try {
      const socketId = this.connectedUsers.get(userId.toString());
      
      if (socketId) {
        this.io.to(`user_${userId}`).emit(event, data);
        logger.info(`Event ${event} sent to user ${userId}`, { data });
        return true;
      } else {
        logger.warn(`User ${userId} not connected, cannot send event ${event}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error sending event ${event} to user ${userId}:`, error);
      return false;
    }
  }

  // Send to multiple users
  async sendToUsers(userIds, event, data) {
    try {
      const results = await Promise.all(
        userIds.map(userId => this.sendToUser(userId, event, data))
      );
      
      return results.filter(result => result).length; // Count successful sends
    } catch (error) {
      logger.error(`Error sending event ${event} to multiple users:`, error);
      return 0;
    }
  }

  // Send to all users with specific role
  sendToRole(role, event, data) {
    try {
      this.io.to(`role_${role}`).emit(event, data);
      logger.info(`Event ${event} sent to all ${role}s`, { data });
      return true;
    } catch (error) {
      logger.error(`Error sending event ${event} to role ${role}:`, error);
      return false;
    }
  }

  // Broadcast to all connected users
  broadcast(event, data) {
    try {
      this.io.emit(event, data);
      logger.info(`Event ${event} broadcasted to all users`, { data });
      return true;
    } catch (error) {
      logger.error(`Error broadcasting event ${event}:`, error);
      return false;
    }
  }

  // Send product update to all viewers
  sendProductUpdate(productId, updateData) {
    try {
      this.io.to(`product_${productId}`).emit('product_updated', {
        productId,
        ...updateData,
        timestamp: new Date()
      });
      
      logger.info(`Product update sent for product ${productId}`, updateData);
      return true;
    } catch (error) {
      logger.error(`Error sending product update for ${productId}:`, error);
      return false;
    }
  }

  // Send order update to relevant parties
  sendOrderUpdate(orderId, updateData, recipients = []) {
    try {
      // Send to order room
      this.io.to(`order_${orderId}`).emit('order_updated', {
        orderId,
        ...updateData,
        timestamp: new Date()
      });
      
      // Send to specific recipients if provided
      recipients.forEach(userId => {
        this.sendToUser(userId, 'order_updated', {
          orderId,
          ...updateData,
          timestamp: new Date()
        });
      });
      
      logger.info(`Order update sent for order ${orderId}`, updateData);
      return true;
    } catch (error) {
      logger.error(`Error sending order update for ${orderId}:`, error);
      return false;
    }
  }

  // Get online users count
  getOnlineUsersCount() {
    return this.connectedUsers.size;
  }

  // Get online users by role
  getOnlineUsersByRole(role) {
    const users = [];
    for (const [socketId, userData] of this.userSockets) {
      if (userData.role === role) {
        users.push(userData);
      }
    }
    return users;
  }

  // Check if user is online
  isUserOnline(userId) {
    return this.connectedUsers.has(userId.toString());
  }

  // Get socket instance for external use
  getIO() {
    return this.io;
  }
}

// Create singleton instance
const socketService = new SocketService();

module.exports = socketService;