const mongoose = require('mongoose');

const emailLogSchema = new mongoose.Schema({
  to: {
    type: String,
    required: [true, 'Recipient email is required'],
    lowercase: true
  },
  from: {
    type: String,
    required: [true, 'Sender email is required'],
    lowercase: true
  },
  subject: {
    type: String,
    required: [true, 'Email subject is required'],
    maxlength: 200
  },
  template: {
    name: {
      type: String,
      required: [true, 'Template name is required']
    },
    variables: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  htmlContent: {
    type: String,
    required: true
  },
  textContent: String,
  status: {
    type: String,
    enum: [
      'queued',        // Email queued for sending
      'sending',       // Email is being sent
      'sent',          // Email sent successfully
      'delivered',     // Email delivered to recipient
      'opened',        // Email opened by recipient
      'clicked',       // Link in email clicked
      'bounced',       // Email bounced
      'failed',        // Email sending failed
      'spam',          // Email marked as spam
      'unsubscribed'   // Recipient unsubscribed
    ],
    default: 'queued'
  },
  provider: {
    type: String,
    enum: ['sendgrid', 'smtp', 'nodemailer'],
    required: true
  },
  providerData: {
    messageId: String,
    transactionId: String,
    batchId: String
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  category: {
    type: String,
    enum: [
      'verification',
      'order_confirmation', 
      'sale_notification',
      'payout_notification',
      'product_notification',
      'system_alert',
      'marketing',
      'password_reset',
      'welcome',
      'notification'
    ],
    required: true
  },
  metadata: {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    },
    campaignId: String,
    tags: [String]
  },
  attempts: {
    count: {
      type: Number,
      default: 0
    },
    maxAttempts: {
      type: Number,
      default: 3
    },
    lastAttempt: Date,
    nextRetry: Date
  },
  error: {
    message: String,
    code: String,
    stack: String,
    timestamp: Date
  },
  events: [{
    event: {
      type: String,
      enum: ['queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'spam', 'unsubscribed']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    data: mongoose.Schema.Types.Mixed
  }],
  sentAt: Date,
  deliveredAt: Date,
  openedAt: Date,
  clickedAt: Date,
  bouncedAt: Date,
  failedAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient queries
emailLogSchema.index({ to: 1, createdAt: -1 });
emailLogSchema.index({ status: 1, createdAt: -1 });
emailLogSchema.index({ category: 1, createdAt: -1 });
emailLogSchema.index({ provider: 1, status: 1 });
emailLogSchema.index({ 'metadata.userId': 1, createdAt: -1 });
emailLogSchema.index({ 'metadata.orderId': 1 });
emailLogSchema.index({ 'providerData.messageId': 1 });
emailLogSchema.index({ 'attempts.nextRetry': 1, status: 1 });

// Method to mark email as sent
emailLogSchema.methods.markAsSent = function(providerData = {}) {
  this.status = 'sent';
  this.sentAt = new Date();
  this.providerData = { ...this.providerData, ...providerData };
  this.events.push({
    event: 'sent',
    timestamp: new Date(),
    data: providerData
  });
  return this.save();
};

// Method to mark email as failed
emailLogSchema.methods.markAsFailed = function(error) {
  this.status = 'failed';
  this.failedAt = new Date();
  this.error = {
    message: error.message || 'Unknown error',
    code: error.code || 'UNKNOWN',
    stack: error.stack,
    timestamp: new Date()
  };
  this.events.push({
    event: 'failed',
    timestamp: new Date(),
    data: { error: error.message }
  });
  return this.save();
};

// Method to increment attempt count
emailLogSchema.methods.incrementAttempt = function() {
  this.attempts.count += 1;
  this.attempts.lastAttempt = new Date();
  
  if (this.attempts.count < this.attempts.maxAttempts) {
    // Calculate next retry time (exponential backoff)
    const delay = Math.min(300000 * Math.pow(2, this.attempts.count), 3600000); // Max 1 hour
    this.attempts.nextRetry = new Date(Date.now() + delay);
  } else {
    this.status = 'failed';
    this.failedAt = new Date();
    this.error = {
      message: 'Maximum retry attempts exceeded',
      code: 'MAX_ATTEMPTS_EXCEEDED',
      timestamp: new Date()
    };
  }
  
  return this.save();
};

// Static method to get email statistics
emailLogSchema.statics.getStats = function(timeframe = '24h') {
  const now = new Date();
  let startTime;
  
  switch (timeframe) {
    case '1h':
      startTime = new Date(now.getTime() - 60 * 60 * 1000);
      break;
    case '24h':
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      break;
    case '7d':
      startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    default:
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  }
  
  return this.aggregate([
    {
      $match: {
        createdAt: { $gte: startTime }
      }
    },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
};

module.exports = mongoose.model('EmailLog', emailLogSchema);