const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000
  },
  messageType: {
    type: String,
    enum: ['text', 'image', 'system'],
    default: 'text'
  },
  attachments: [{
    type: String,
    url: String,
    contentType: String
  }],
  readBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    readAt: {
      type: Date,
      default: Date.now
    }
  }],
  status: {
    type: String,
    enum: ['sent', 'delivered', 'read'],
    default: 'sent'
  }
}, {
  timestamps: true
});

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  type: {
    type: String,
    enum: ['direct', 'group'],
    default: 'direct'
  },
  title: {
    type: String,
    maxlength: 100
  },
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  unreadCount: {
    type: Map,
    of: Number,
    default: new Map()
  },
  metadata: {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    },
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product'
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ sender: 1, createdAt: -1 });
conversationSchema.index({ participants: 1 });
conversationSchema.index({ 'metadata.orderId': 1 });
conversationSchema.index({ 'metadata.productId': 1 });

// Methods
messageSchema.methods.markAsRead = async function(userId) {
  if (!this.readBy.some(read => read.user.equals(userId))) {
    this.readBy.push({ user: userId });
    await this.save();
  }
};

conversationSchema.methods.incrementUnread = async function(userId) {
  const count = this.unreadCount.get(userId.toString()) || 0;
  this.unreadCount.set(userId.toString(), count + 1);
  await this.save();
};

conversationSchema.methods.clearUnread = async function(userId) {
  this.unreadCount.set(userId.toString(), 0);
  await this.save();
};

// Pre-save hooks
messageSchema.pre('save', async function(next) {
  if (this.isNew) {
    const conversation = await mongoose.model('Conversation').findById(this.conversationId);
    if (conversation) {
      conversation.lastMessage = this._id;
      // Increment unread count for all participants except sender
      for (const participant of conversation.participants) {
        if (!participant.equals(this.sender)) {
          await conversation.incrementUnread(participant);
        }
      }
      await conversation.save();
    }
  }
  next();
});

const Message = mongoose.model('Message', messageSchema);
const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = { Message, Conversation };