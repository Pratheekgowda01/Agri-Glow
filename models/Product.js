const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  farmerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Farmer ID is required']
  },
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
    maxlength: 100
  },
  description: {
    type: String,
    maxlength: 500,
    default: ''
  },
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: ['vegetables', 'fruits', 'grains', 'dairy', 'flowers', 'others'],
    lowercase: true
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  unit: {
    type: String,
    required: [true, 'Unit is required'],
    enum: ['kg', 'gram', 'piece', 'dozen', 'bundle', 'litre']
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [0, 'Quantity cannot be negative']
  },
  minOrderQuantity: {
    type: Number,
    default: 1,
    min: [1, 'Minimum order quantity must be at least 1']
  },
  images: [{
    url: {
      type: String,
      required: true
    },
    alt: {
      type: String,
      default: ''
    }
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  isOrganic: {
    type: Boolean,
    default: false
  },
  harvestDate: {
    type: Date,
    required: [true, 'Harvest date is required']
  },
  expiryDate: {
    type: Date,
    required: [true, 'Expiry date is required']
  },
  location: {
    address: {
      type: String,
      default: ''
    },
    coordinates: {
      type: [Number],
      default: [0, 0],
      validate: {
        validator: function(v) {
          return v.length === 2 && v[0] >= -180 && v[0] <= 180 && v[1] >= -90 && v[1] <= 90;
        },
        message: 'Invalid coordinates'
      }
    }
  },
  ratings: {
    average: {
      type: Number,
      default: 0,
      min: 0,
      max: 5
    },
    count: {
      type: Number,
      default: 0
    }
  },
  tags: [{
    type: String,
    trim: true
  }]
}, { timestamps: true });

productSchema.index({ category: 1 });
productSchema.index({ farmerId: 1 });
productSchema.index({ isActive: 1 });
// productSchema.index({ 'location.coordinates': '2dsphere' }); // Disabled for simple coordinate arrays
productSchema.index({ name: 'text', description: 'text', tags: 'text' });

productSchema.virtual('inStock').get(function() {
  return this.quantity > 0 && this.isActive;
});

productSchema.pre('save', function(next) {
  if (this.expiryDate && this.harvestDate && this.expiryDate <= this.harvestDate) {
    next(new Error('Expiry date must be after harvest date'));
  }
  next();
});

module.exports = mongoose.model('Product', productSchema);
