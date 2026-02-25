const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const BuyerSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  address: { type: String, required: true },
  categoryInterests: [{ type: String, enum: ['fruits', 'vegetables', 'grains', 'dairy', 'others'] }],
  password: { type: String, required: true },

  profileImage: { type: String },
  createdAt: { type: Date, default: Date.now }
});

BuyerSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

BuyerSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('Buyer', BuyerSchema);
