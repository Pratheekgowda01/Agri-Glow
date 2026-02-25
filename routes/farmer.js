const express = require('express');
const router = express.Router();
const User = require('../models/User'); // Use unified User model instead of Farmer
const Product = require('../models/Product');
const Order = require('../models/Order');
const mailer = require('../services/mailer');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs').promises;
const { auth } = require('../middleware/auth');

// Multer config for profile image upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../public/uploads/users'));
  },
  filename: function (req, file, cb) {
    cb(null, 'farmer-' + Date.now() + path.extname(file.originalname));
  }
});

const productStorage = multer.memoryStorage();

const upload = multer({ storage });
const uploadProductImages = multer({
  storage: productStorage,
  limits: {
    fileSize: 5 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

async function saveProductImage(buffer, filename) {
  const uploadsDir = path.join(__dirname, '../public/uploads/products');
  try {
    await fs.access(uploadsDir);
  } catch {
    await fs.mkdir(uploadsDir, { recursive: true });
  }
  const filePath = path.join(uploadsDir, filename);
  await sharp(buffer)
    .resize(800, 600, {
      fit: 'cover',
      withoutEnlargement: true
    })
    .jpeg({
      quality: 85,
      progressive: true
    })
    .toFile(filePath);
  return `/uploads/products/${filename}`;
}

function requireFarmerOwnership(req, res, product) {
  if (req.userRole !== 'farmer' || !product || product.farmerId.toString() !== req.userId.toString()) {
    res.status(403).json({ success: false, message: 'Not authorized' });
    return false;
  }
  return true;
}

// Register Farmer
router.post('/register', async (req, res) => {
  try {
    const { name, location, email, phone, category, password } = req.body;
    if (await User.findOne({ $or: [{ email }, { phone }] })) {
      return res.status(400).json({ success: false, message: 'Email or phone already registered.' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpires = Date.now() + 10 * 60 * 1000;
    const farmer = new User({ 
      name, 
      location, 
      email, 
      phone, 
      category, 
      password, 
      role: 'farmer',
      otp, 
      otpExpires 
    });
    await farmer.save();
    await mailer.sendWithSMTP({
      to: email,
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      subject: 'Agri Glow Email Verification OTP',
      html: `<h2>Your OTP: <b>${otp}</b></h2><p>Enter this code to verify your email for Agri Glow.</p>`
    });
    res.json({ success: true, message: 'Registration successful. OTP sent to email.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const farmer = await User.findOne({ email, role: 'farmer' }).select('+otp +otpExpires');
    if (!farmer) return res.status(404).json({ success: false, message: 'Farmer not found.' });
    if (farmer.verified) return res.json({ success: true, message: 'Already verified.' });
    if (farmer.otp !== otp || Date.now() > farmer.otpExpires) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
    }
    farmer.verified = true;
    farmer.otp = undefined;
    farmer.otpExpires = undefined;
    await farmer.save();
    res.json({ success: true, message: 'Email verified. You can now login.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Farmer Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const farmer = await User.findOne({ email, role: 'farmer' }).select('+password');
    if (!farmer) return res.status(404).json({ success: false, message: 'Farmer not found.' });
    if (!farmer.verified) return res.status(403).json({ success: false, message: 'Email not verified.' });
    const match = await farmer.comparePassword(password);
    if (!match) return res.status(401).json({ success: false, message: 'Incorrect password.' });
    if (!farmer.lastLogin) {
      await mailer.sendWithSMTP({
        to: farmer.email,
        subject: '🌾 Welcome to Agri Glow, ' + farmer.name + '!',
        html: `<h2 style='color:#27ae60;'>Welcome to Agri Glow 🌾</h2>
        <p>Hi <b>${farmer.name}</b>,</p>
        <p>Thank you for joining <b>Agri Glow</b> — your digital marketplace to sell fresh produce directly to buyers without any mediators.</p>
        <p>You can now list your <b>fruits</b>, <b>vegetables</b>, <b>grains</b>, and <b>dairy products</b> with full control over pricing and availability.</p>
        <p>🚜 Let’s grow smarter, together!</p>
        <br><p>— Team Agri Glow</p>`
      });
    }
    farmer.lastLogin = new Date();
    await farmer.save();
    res.json({ success: true, message: 'Login successful.', farmer: { id: farmer._id, name: farmer.name, email: farmer.email, role: farmer.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get Farmer Profile
router.get('/profile/:id', async (req, res) => {
  try {
    const farmer = await User.findById(req.params.id);
    if (!farmer || farmer.role !== 'farmer') return res.status(404).json({ success: false, message: 'Farmer not found.' });
    res.json({ success: true, farmer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update Farmer Profile
router.put('/profile/:id', upload.single('profileImage'), async (req, res) => {
  try {
    const update = req.body;
    if (req.file) {
      update.profileImage = '/uploads/users/' + req.file.filename;
    }
    const farmer = await User.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!farmer || farmer.role !== 'farmer') return res.status(404).json({ success: false, message: 'Farmer not found.' });
    res.json({ success: true, farmer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Farmer Product Routes
router.get('/products/:farmerId', auth, async (req, res) => {
  try {
    if (req.userRole !== 'farmer' || req.userId.toString() !== req.params.farmerId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const products = await Product.find({ farmerId: req.params.farmerId }).sort('-createdAt');
    res.json({ success: true, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/products/detail/:id', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!requireFarmerOwnership(req, res, product)) {
      return;
    }
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/products/:farmerId', auth, uploadProductImages.array('images', 5), async (req, res) => {
  try {
    if (req.userRole !== 'farmer' || req.userId.toString() !== req.params.farmerId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const {
      name,
      description,
      category,
      price,
      unit,
      quantity,
      minOrderQuantity,
      harvestDate,
      expiryDate,
      isOrganic
    } = req.body;
    const images = [];
    if (req.files?.length) {
      for (const file of req.files) {
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
        const url = await saveProductImage(file.buffer, filename);
        images.push({ url, alt: `${name} image` });
      }
    }
    const product = await Product.create({
      farmerId: req.params.farmerId,
      name,
      description,
      category,
      price,
      unit,
      quantity,
      minOrderQuantity,
      harvestDate,
      expiryDate,
      isOrganic: isOrganic === 'true' || isOrganic === true,
      images
    });
    res.status(201).json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/products/:id', auth, uploadProductImages.array('images', 5), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!requireFarmerOwnership(req, res, product)) {
      return;
    }
    const updates = {
      name: req.body.name ?? product.name,
      description: req.body.description ?? product.description,
      category: req.body.category ?? product.category,
      price: req.body.price ?? product.price,
      unit: req.body.unit ?? product.unit,
      quantity: req.body.quantity ?? product.quantity,
      minOrderQuantity: req.body.minOrderQuantity ?? product.minOrderQuantity,
      harvestDate: req.body.harvestDate ?? product.harvestDate,
      expiryDate: req.body.expiryDate ?? product.expiryDate,
      isOrganic: typeof req.body.isOrganic === 'undefined' ? product.isOrganic : (req.body.isOrganic === 'true' || req.body.isOrganic === true)
    };
    if (req.files?.length) {
      const newImages = [];
      for (const file of req.files) {
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}.jpg`;
        const url = await saveProductImage(file.buffer, filename);
        newImages.push({ url, alt: `${updates.name} image` });
      }
      updates.images = req.body.replaceImages === 'true' ? newImages : [...product.images, ...newImages];
    }
    Object.assign(product, updates);
    await product.save();
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/products/:id', auth, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!requireFarmerOwnership(req, res, product)) {
      return;
    }
    await product.deleteOne();
    res.json({ success: true, message: 'Product deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Farmer Orders
router.get('/orders/:farmerId', auth, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.farmerId) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const orders = await Order.find({ farmerId: req.params.farmerId })
      .populate('buyerId', 'name phone')
      .populate('productId', 'name unit')
      .sort('-createdAt');
    const formatted = orders.map(order => ({
      _id: order._id,
      status: order.status,
      total: order.totalAmount,
      buyer: {
        name: order.buyerId?.name || 'Buyer',
        phone: order.buyerId?.phone || 'N/A'
      },
      deliveryAddress: order.deliveryDetails?.address?.street || 'N/A',
      items: [{
        product: {
          name: order.productId?.name || 'Product',
          unit: order.productId?.unit || 'unit'
        },
        quantity: order.quantity
      }]
    }));
    res.json({ success: true, orders: formatted });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/orders/:id/status', auth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    if (order.farmerId.toString() !== req.userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }
    const allowedStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'in_transit', 'delivered', 'cancelled'];
    if (!allowedStatuses.includes(req.body.status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    order.status = req.body.status;
    await order.save();
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
