const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Product = require('../models/Product');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { auth, farmerOnly, verifiedUser } = require('../middleware/auth');
const socketService = require('../services/socket');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

const router = express.Router();

// Configure multer for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Helper function to process and save images
const processAndSaveImage = async (buffer, filename) => {
  const uploadsDir = path.join(__dirname, '../public/uploads/products');
  
  // Ensure uploads directory exists
  try {
    await fs.access(uploadsDir);
  } catch {
    await fs.mkdir(uploadsDir, { recursive: true });
  }

  const imagePath = path.join(uploadsDir, filename);
  
  // Process image with Sharp
  await sharp(buffer)
    .resize(800, 600, { 
      fit: 'cover',
      withoutEnlargement: true 
    })
    .jpeg({ 
      quality: 85,
      progressive: true 
    })
    .toFile(imagePath);
    
  return '/uploads/products/' + filename;
};

// GET /api/products - Get all products
router.get('/', async (req, res) => {
  try {
    const products = await Product.find({ isActive: true })
      .populate('farmerId', 'name location ratings')
      .sort('-createdAt');
    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/products/:id/image - Get product image or placeholder
router.get('/:id/image', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product || !product.images || product.images.length === 0) {
      // Redirect to placeholder image
      return res.redirect('https://via.placeholder.com/300x180/00CC99/ffffff?text=No+Image');
    }
    
    const imageUrl = product.images[0].url;
    if (imageUrl.startsWith('http')) {
      return res.redirect(imageUrl);
    } else {
      // Local file path
      const imagePath = path.join(__dirname, '..', 'public', imageUrl);
      if (fsSync.existsSync(imagePath)) {
        return res.sendFile(imagePath);
      }
    }
    
    // Fallback to placeholder
    return res.redirect('https://via.placeholder.com/300x180/00CC99/ffffff?text=No+Image');
    
  } catch (error) {
    console.error('Error fetching product image:', error);
    return res.redirect('https://via.placeholder.com/300x180/00CC99/ffffff?text=Error');
  }
});

// GET /api/products/:id - Get single product
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('farmerId', 'name location ratings phone');
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      data: product
    });
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/products - Create new product
router.post('/', auth, farmerOnly, upload.array('images', 5), async (req, res) => {
  try {
    const {
      name,
      description,
      category,
      price,
      unit,
      quantity,
      minOrderQuantity = 1,
      harvestDate,
      expiryDate,
      isOrganic = false,
      tags = []
    } = req.body;

    // Process images
    const images = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}.jpg`;
        const imageUrl = await processAndSaveImage(file.buffer, filename);
        images.push({
          url: imageUrl,
          alt: `${name} image`
        });
      }
    }

    const product = new Product({
      farmerId: req.userId,
      name,
      description,
      category,
      price: parseFloat(price),
      unit,
      quantity: parseInt(quantity),
      minOrderQuantity: parseInt(minOrderQuantity),
      images,
      harvestDate: new Date(harvestDate),
      expiryDate: new Date(expiryDate),
      isOrganic,
      isActive: true,
      tags: Array.isArray(tags) ? tags : []
    });

    await product.save();

    // Create notification for the farmer
    try {
      await Notification.createAndDeliver({
        userId: req.userId,
        title: 'Product listed successfully',
        message: `Your product "${product.name}" is now live on the marketplace`,
        type: 'product_activated',
        category: 'product',
        priority: 'normal',
        data: {
          productId: product._id,
          category: product.category,
          quantity: product.quantity,
          price: product.price
        },
        channels: {
          inApp: true,
          email: true,
          sms: false,
          push: false
        }
      });
    } catch (notifyError) {
      console.error('Failed to deliver product notification:', notifyError);
    }

    // Notify relevant users via sockets
    await socketService.sendToUser(req.userId, 'product_created', {
      productId: product._id,
      name: product.name,
      category: product.category,
      quantity: product.quantity,
      price: product.price,
      createdAt: product.createdAt
    });

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product
    });
  } catch (error) {
    console.error('Error creating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create product',
      error: error.message
    });
  }
});

// PUT /api/products/:id - Update product
router.put('/:id', auth, farmerOnly, upload.array('images', 5), async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (product.farmerId.toString() !== req.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this product'
      });
    }

    const updates = req.body;

    // Process new images
    if (req.files && req.files.length > 0) {
      const newImages = [];
      for (const file of req.files) {
        const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 11)}.jpg`;
        const imageUrl = await processAndSaveImage(file.buffer, filename);
        newImages.push({
          url: imageUrl,
          alt: `${updates.name || product.name} image`
        });
      }
      updates.images = req.body.replaceImages === 'true' ? newImages : [...product.images, ...newImages];
    }

    Object.assign(product, updates);
    await product.save();

    // Notify relevant users
    socketService.broadcast('product-updated', {
      type: 'product_updated',
      productId: product._id,
      updates: Object.keys(updates)
    });

    res.json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    console.error('Error updating product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: error.message
    });
  }
});

// DELETE /api/products/:id - Delete product
router.delete('/:id', auth, farmerOnly, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    if (product.farmerId.toString() !== req.userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this product'
      });
    }

    await Product.findByIdAndDelete(req.params.id);

    // Notify relevant users
    socketService.broadcast('product-deleted', {
      type: 'product_deleted',
      productId: product._id
    });

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product',
      error: error.message
    });
  }
});

// GET /api/products/farmer/:id - Get products by farmer
router.get('/farmer/:id', async (req, res) => {
  try {
    const products = await Product.find({ 
      farmerId: req.params.id,
      isActive: true 
    }).populate('farmerId', 'name location ratings');
    
    res.json({
      success: true,
      products
    });
  } catch (error) {
    console.error('Error fetching farmer products:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch farmer products',
      error: error.message
    });
  }
});

module.exports = router;