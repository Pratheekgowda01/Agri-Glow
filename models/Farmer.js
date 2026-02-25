const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const FarmerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  location: {
    address: { type: String },
    lat: { type: Number },
    lng: { type: Number }
  },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  category: { type: String, enum: ['fruits', 'vegetables', 'grains', 'dairy', 'others'], required: true },
  password: { type: String, required: true },

  status: { type: String, enum: ['active', 'stopped'], default: 'active' },
  profileImage: { type: String },
  createdAt: { type: Date, default: Date.now }
});

FarmerSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

FarmerSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Farmer', FarmerSchema);
