const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true,
    required: true
  },
  pricingSnapshot: {
    unitPrice: Number,
    quantity: Number,
    subtotal: Number,
    shipping: Number,
    tax: Number,
    total: Number,
    clientSubtotal: Number,
    clientShipping: Number,
    clientTax: Number,
    clientTotal: Number,
    mismatchDetected: {
      type: Boolean,
      default: false
    },
    mismatchReason: String
  },
  buyerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Buyer ID is required']
  },
  buyerSnapshot: {
    name: String,
    phone: String,
    email: String
  },
  farmerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Farmer ID is required']
  },
  farmerSnapshot: {
    name: String,
    email: String
  },
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: [true, 'Product ID is required']
  },
  productSnapshot: {
    name: String,
    unit: String,
    sku: String,
    category: String
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1']
  },
  unitPrice: {
    type: Number,
    required: [true, 'Unit price is required'],
    min: [0, 'Unit price cannot be negative']
  },
  subtotalAmount: Number,
  shippingAmount: Number,
  taxAmount: Number,
  totalAmount: {
    type: Number,
    required: [true, 'Total amount is required'],
    min: [0, 'Total amount cannot be negative']
  },
  status: {
    type: String,
    enum: [
      'pending',           // Order placed, payment pending
      'payment_failed',    // Payment failed
      'confirmed',         // Payment successful
      'processing',        // Farmer is preparing the order
      'shipped',           // Order has been shipped
      'in_transit',        // Order is being delivered
      'delivered',         // Order delivered successfully
      'cancelled',         // Order cancelled
      'refunded',          // Order refunded
      'disputed'           // Order in dispute
    ],
    default: 'pending'
  },
  escrowStatus: {
    type: String,
    enum: ['not_applicable', 'on_hold', 'awaiting_release', 'release_requested', 'released', 'cancelled'],
    default: 'not_applicable'
  },
  escrowTimeline: [{
    status: String,
    note: String,
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  paymentDetails: {
    paymentId: String,
    paymentMethod: {
      type: String,
      enum: ['razorpay', 'stripe', 'wallet', 'cod'],
      default: 'razorpay'
    },
    transactionId: String,
    paidAt: Date,
    paymentStatus: {
      type: String,
      enum: ['pending', 'completed', 'failed', 'refunded'],
      default: 'pending'
    },
    escrow: {
      isEscrow: {
        type: Boolean,
        default: false
      },
      adminHoldAmount: {
        type: Number,
        default: 0
      },
      buyerReleaseOtp: {
        type: String,
        select: false
      },
      otpExpiresAt: Date,
      releaseStatus: {
        type: String,
        enum: ['pending', 'otp_sent', 'otp_verified', 'release_requested', 'released', 'cancelled'],
        default: 'pending'
      },
      releaseRequestedAt: Date,
      releaseRequestChannel: {
        type: String,
        enum: ['buyer_portal', 'support', 'auto']
      },
      releasedAt: Date,
      releasedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      releaseNotes: String,
      lastNotifiedAt: Date
    }
  },
  deliveryDetails: {
    address: {
      street: { type: String, required: true },
      city: { type: String, required: true },
      state: { type: String, required: true },
      pincode: { type: String, required: true },
      landmark: String
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    },
    deliveryDate: Date,
    deliveryTimeSlot: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'flexible'],
      default: 'flexible'
    },
    deliveryInstructions: String,
    trackingId: String
  },
  timeline: [{
    status: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    note: String,
    location: {
      type: [Number], // [longitude, latitude]
      default: [0, 0]
    }
  }],
  rating: {
    productRating: {
      type: Number,
      min: 1,
      max: 5
    },
    farmerRating: {
      type: Number,
      min: 1,
      max: 5
    },
    review: String,
    reviewDate: Date
  },
  notes: {
    buyerNotes: String,
    farmerNotes: String,
    adminNotes: String
  },
  cancellation: {
    cancelledBy: {
      type: String,
      enum: ['buyer', 'farmer', 'admin', 'system']
    },
    reason: String,
    cancelledAt: Date,
    refundAmount: Number,
    refundStatus: {
      type: String,
      enum: ['pending', 'processed', 'failed'],
      default: 'pending'
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for efficient queries
orderSchema.index({ buyerId: 1, createdAt: -1 });
orderSchema.index({ farmerId: 1, createdAt: -1 });
orderSchema.index({ productId: 1, createdAt: -1 });
orderSchema.index({ orderId: 1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index({ 'paymentDetails.paymentId': 1 });

// Virtual to populate buyer details
orderSchema.virtual('buyer', {
  ref: 'User',
  localField: 'buyerId',
  foreignField: '_id',
  justOne: true
});

// Virtual to populate farmer details
orderSchema.virtual('farmer', {
  ref: 'User',
  localField: 'farmerId',
  foreignField: '_id',
  justOne: true
});

// Virtual to populate product details
orderSchema.virtual('product', {
  ref: 'Product',
  localField: 'productId',
  foreignField: '_id',
  justOne: true
});

// Pre-save middleware to generate order ID
orderSchema.pre('save', function(next) {
  if (this.isNew && !this.orderId) {
    const timestamp = Date.now().toString();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.orderId = `AG${timestamp}${random}`;
  }
  
  // Add to timeline when status changes
  if (this.isModified('status') && !this.isNew) {
    this.timeline.push({
      status: this.status,
      timestamp: new Date(),
      note: `Order status changed to ${this.status}`
    });
  }
  
  next();
});

// Method to check if order can be cancelled
orderSchema.methods.canBeCancelled = function() {
  const cancelableStatuses = ['pending', 'confirmed', 'processing'];
  return cancelableStatuses.includes(this.status);
};

// Method to calculate refund amount
orderSchema.methods.calculateRefundAmount = function() {
  if (this.status === 'delivered') {
    return 0;
  }
  if (this.status === 'shipped' || this.status === 'in_transit') {
    return this.totalAmount * 0.8; // 20% cancellation fee
  }
  return this.totalAmount; // Full refund for early cancellation
};

module.exports = mongoose.model('Order', orderSchema);