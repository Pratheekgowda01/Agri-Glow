const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  title: {
    type: String,
    required: [true, 'Notification title is required'],
    maxlength: 100
  },
  message: {
    type: String,
    required: [true, 'Notification message is required'],
    maxlength: 500
  },
  type: {
    type: String,
    enum: [
      'order_placed',      // Buyer placed an order
      'order_confirmed',   // Payment confirmed
      'order_shipped',     // Order shipped by farmer
      'order_delivered',   // Order delivered
      'order_cancelled',   // Order cancelled
      'product_sold_out',  // Product went out of stock
      'product_activated', // Product activated by farmer
      'product_deactivated', // Product deactivated by farmer
      'payment_received',  // Farmer received payment
      'payment_failed',    // Payment failed
      'low_stock',         // Product running low on stock
      'new_review',        // New review received
      'account_verified',  // Account verification complete
      'welcome',           // Welcome notification
      'system_alert',      // System maintenance/alerts
      'promotion',         // Promotional notifications
      'security_alert'     // Security-related alerts
    ],
    required: true
  },
  category: {
    type: String,
    enum: ['order', 'product', 'payment', 'account', 'system', 'marketing'],
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  status: {
    type: String,
    enum: ['unread', 'read', 'archived'],
    default: 'unread'
  },
  data: {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    amount: Number,
    quantity: Number,
    actionUrl: String,
    actionText: String,
    imageUrl: String,
    metadata: mongoose.Schema.Types.Mixed
  },
  channels: {
    inApp: {
      type: Boolean,
      default: true
    },
    email: {
      type: Boolean,
      default: false
    },
    sms: {
      type: Boolean,
      default: false
    },
    push: {
      type: Boolean,
      default: false
    }
  },
  delivery: {
    inApp: {
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
      readAt: Date
    },
    email: {
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
      openedAt: Date,
      emailLogId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'EmailLog'
      }
    },
    sms: {
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
      messageId: String
    },
    push: {
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
      messageId: String
    }
  },
  scheduledFor: {
    type: Date,
    default: Date.now
  },
  expiresAt: Date,
  readAt: Date,
  archivedAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient queries
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
notificationSchema.index({ priority: 1, status: 1 });
notificationSchema.index({ scheduledFor: 1, status: 1 });
notificationSchema.index({ expiresAt: 1 });
notificationSchema.index({ 'data.orderId': 1 });
notificationSchema.index({ 'data.productId': 1 });

// Virtual to populate user details
notificationSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Virtual to populate order details
notificationSchema.virtual('order', {
  ref: 'Order',
  localField: 'data.orderId',
  foreignField: '_id',
  justOne: true
});

// Virtual to populate product details
notificationSchema.virtual('product', {
  ref: 'Product',
  localField: 'data.productId',
  foreignField: '_id',
  justOne: true
});

// Method to mark notification as read
notificationSchema.methods.markAsRead = function() {
  if (this.status === 'unread') {
    this.status = 'read';
    this.readAt = new Date();
    this.delivery.inApp.readAt = new Date();
  }
  return this.save();
};

// Method to archive notification
notificationSchema.methods.archive = function() {
  this.status = 'archived';
  this.archivedAt = new Date();
  return this.save();
};

// Static method to create and deliver notification
notificationSchema.statics.createAndDeliver = async function(notificationData) {
  const notification = new this(notificationData);
  await notification.save();
  
  // Emit real-time notification via Socket.IO
  const io = require('../services/socket');
  if (io) {
    io.to(`user_${notification.userId}`).emit('notification', {
      id: notification._id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      priority: notification.priority,
      data: notification.data,
      createdAt: notification.createdAt
    });
  }
  
  // Queue email notification if enabled
  if (notification.channels.email) {
    const emailQueue = require('../services/emailQueue');
    await emailQueue.addEmailJob('notification', {
      notificationId: notification._id,
      userId: notification.userId,
      type: notification.type,
      data: notification.data
    });
  }
  
  // Queue SMS notification if enabled
  if (notification.channels.sms) {
    const smsQueue = require('../services/smsQueue');
    await smsQueue.addSmsJob('notification', {
      notificationId: notification._id,
      userId: notification.userId,
      message: notification.message,
      type: notification.type
    });
  }
  
  return notification;
};

// Static method to get user notification counts
notificationSchema.statics.getUserCounts = function(userId) {
  return this.aggregate([
    { $match: { userId: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
};

// Static method to clean up expired notifications
notificationSchema.statics.cleanupExpired = function() {
  const now = new Date();
  return this.deleteMany({
    expiresAt: { $lt: now }
  });
};

// Auto-expire old notifications (run daily via cron)
notificationSchema.statics.autoArchiveOld = function(daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return this.updateMany(
    {
      createdAt: { $lt: cutoffDate },
      status: { $ne: 'archived' }
    },
    {
      status: 'archived',
      archivedAt: new Date()
    }
  );
};

module.exports = mongoose.model('Notification', notificationSchema);