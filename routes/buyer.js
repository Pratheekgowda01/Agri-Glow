const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const { auth, buyerOnly } = require('../middleware/auth');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const mailerService = require('../services/mailer');

// Initialize Razorpay (only if keys are provided)
let razorpay = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
  razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
}

// Create Order (Simplified for direct purchase)
router.post('/orders', auth, buyerOnly, async (req, res) => {
  try {
    console.log('=== ORDER CREATION START ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    console.log('User ID:', req.userId);
    
    const { productId, quantity, totalAmount, shippingAddress, paymentMethod } = req.body;

    console.log('Parsed values:', {
      productId,
      quantity,
      totalAmount,
      paymentMethod,
      hasShippingAddress: !!shippingAddress
    });

    if (!productId || !quantity || quantity <= 0) {
      console.log('Validation failed: missing productId or invalid quantity');
      return res.status(400).json({ 
        success: false, 
        message: 'Product ID and valid quantity are required.' 
      });
    }

    // Get authenticated buyer
    const buyer = await User.findById(req.userId);
    if (!buyer || buyer.role !== 'buyer') {
      return res.status(403).json({ 
        success: false, 
        message: 'Buyer account required.' 
      });
    }

    // Validate product - don't populate to avoid issues
    const product = await Product.findById(productId);
    if (!product || !product.isActive) {
      return res.status(404).json({ 
        success: false, 
        message: 'Product not found or unavailable.' 
      });
    }

    // Check stock
    if (product.quantity < quantity) {
      return res.status(400).json({ 
        success: false, 
        message: 'Insufficient stock.' 
      });
    }

    if (quantity < product.minOrderQuantity) {
      return res.status(400).json({ 
        success: false, 
        message: `Minimum order quantity is ${product.minOrderQuantity} ${product.unit}.` 
      });
    }

    // Get farmer details - ensure we have the farmerId as a valid ObjectId
    let farmerId;
    
    // Handle farmerId whether it's populated or not
    if (product.farmerId && typeof product.farmerId === 'object' && product.farmerId._id) {
      // Already populated - extract the ID
      farmerId = product.farmerId._id;
    } else if (product.farmerId) {
      // Not populated - use the ID directly
      farmerId = product.farmerId;
    } else {
      console.error('Product has no farmerId:', {
        productId: product._id,
        productName: product.name
      });
      return res.status(500).json({ 
        success: false, 
        message: 'Product has invalid farmer information.' 
      });
    }
    
    // Fetch farmer using the ID
    const farmer = await User.findById(farmerId);
    
    // Validate farmer
    if (!farmer) {
      console.error('Farmer not found for product:', {
        productId: product._id,
        productName: product.name,
        farmerId: farmerId || product.farmerId,
        productFarmerId: product.farmerId,
        farmerIdType: typeof product.farmerId
      });
      return res.status(404).json({ 
        success: false, 
        message: 'Farmer not found for this product. Please contact support.' 
      });
    }
    
    // Check if farmer account is active
    if (farmer.isActive === false) {
      console.error('Farmer account is inactive:', {
        farmerId: farmer._id,
        farmerName: farmer.name,
        productId: product._id
      });
      return res.status(404).json({ 
        success: false, 
        message: 'Farmer account is inactive. This product is no longer available.' 
      });
    }
    
    if (farmer.role !== 'farmer') {
      console.error('User is not a farmer:', {
        userId: farmer._id,
        userName: farmer.name,
        role: farmer.role,
        productId: product._id
      });
      return res.status(404).json({ 
        success: false, 
        message: 'Product owner is not a farmer. This product is invalid.' 
      });
    }
    
    // Ensure farmerId is a valid ObjectId (handle string IDs too)
    let finalFarmerId;
    if (farmer._id) {
      finalFarmerId = farmer._id.toString ? farmer._id.toString() : farmer._id;
    } else if (farmerId) {
      finalFarmerId = farmerId.toString ? farmerId.toString() : farmerId;
    } else {
      console.error('Could not determine farmer ID:', {
        farmer,
        farmerId,
        productFarmerId: product.farmerId
      });
      return res.status(500).json({ 
        success: false, 
        message: 'Internal error: Could not determine farmer ID.' 
      });
    }

    // Calculate totals
    const unitPrice = product.price;
    const subtotal = unitPrice * quantity;
    const tax = subtotal * 0.18; // 18% GST
    // COD has additional ₹50 charge
    const baseShipping = subtotal >= 500 ? 0 : 50;
    const codCharge = (paymentMethod === 'cod') ? 50 : 0;
    const shipping = baseShipping + codCharge;
    const finalTotal = subtotal + shipping + tax;

    // Verify the provided total amount (with tolerance for rounding)
    // Accept either totalAmount or pricing.totalAmount
    const providedTotal = totalAmount || req.body.pricing?.totalAmount;
    if (providedTotal && Math.abs(finalTotal - providedTotal) > 0.01) {
      console.log('Amount mismatch:', { calculated: finalTotal, provided: providedTotal });
      // Still proceed for COD - frontend might calculate differently
      if (paymentMethod !== 'cod') {
        return res.status(400).json({ 
          success: false, 
          message: 'Amount mismatch. Please refresh and try again.' 
        });
      }
    }

    // Prepare delivery address - handle both string and object formats
    let deliveryAddress;
    if (shippingAddress) {
      if (typeof shippingAddress === 'string') {
        deliveryAddress = { street: shippingAddress, city: '', state: '', pincode: '' };
      } else if (shippingAddress.addressLine1 || shippingAddress.address) {
        // Handle object format from frontend
        deliveryAddress = {
          street: shippingAddress.addressLine1 || shippingAddress.address || '',
          addressLine2: shippingAddress.addressLine2 || '',
          city: shippingAddress.city || '',
          state: shippingAddress.state || '',
          pincode: shippingAddress.pincode || '',
          name: shippingAddress.name || buyer.name || '',
          phone: shippingAddress.phone || buyer.phone || ''
        };
      } else {
        deliveryAddress = shippingAddress;
      }
    } else {
      deliveryAddress = {
        street: buyer.location?.address || '',
        city: buyer.location?.city || '',
        state: buyer.location?.state || '',
        pincode: buyer.location?.pincode || '',
        name: buyer.name || '',
        phone: buyer.phone || ''
      };
    }

    // Create order
    console.log('Creating order with data:', {
      buyerId: req.userId,
      farmerId: finalFarmerId,
      productId: product._id,
      quantity,
      unitPrice,
      subtotal,
      shipping,
      tax,
      finalTotal,
      paymentMethod: paymentMethod || 'cod',
      status: paymentMethod === 'cod' ? 'confirmed' : 'pending'
    });

    const orderData = {
      buyerId: req.userId,
      farmerId: finalFarmerId,
      productId: product._id,
      quantity,
      unitPrice,
      subtotalAmount: subtotal,
      shippingAmount: shipping,
      taxAmount: tax,
      totalAmount: finalTotal,
      status: paymentMethod === 'cod' ? 'confirmed' : 'pending',
      buyerSnapshot: {
        name: buyer.name,
        phone: buyer.phone,
        email: buyer.email
      },
      farmerSnapshot: {
        name: farmer.name,
        email: farmer.email
      },
      productSnapshot: {
        name: product.name,
        unit: product.unit,
        category: product.category
      },
      pricingSnapshot: {
        unitPrice,
        quantity,
        subtotal,
        shipping,
        tax,
        total: finalTotal
      },
      paymentDetails: {
        paymentMethod: paymentMethod || 'cod',
        paymentStatus: paymentMethod === 'cod' ? 'pending' : 'pending',
        transactionId: paymentMethod === 'cod' ? null : undefined,
        paidAt: paymentMethod === 'cod' ? new Date() : undefined
      },
      deliveryDetails: {
        address: deliveryAddress,
        deliveryTimeSlot: 'flexible'
      }
    };

    console.log('Order data prepared:', JSON.stringify(orderData, null, 2));

    const order = new Order(orderData);
    
    // Initialize timeline if needed
    if (!order.timeline) {
      order.timeline = [];
    }
    
    console.log('Saving order to database...');
    try {
      await order.save();
      console.log('Order saved successfully. Order ID:', order.orderId);
    } catch (saveError) {
      console.error('Error saving order:', saveError);
      if (saveError.name === 'ValidationError') {
        const errors = Object.keys(saveError.errors || {}).map(key => ({
          field: key,
          message: saveError.errors[key].message
        }));
        console.error('Validation errors:', errors);
        return res.status(400).json({
          success: false,
          message: 'Order validation failed',
          errors
        });
      }
      throw saveError; // Re-throw to be caught by outer catch
    }

    // Reduce product quantity
    product.quantity -= quantity;
    if (product.quantity <= 0) {
      product.isActive = false;
    }
    await product.save();

    // Send confirmation emails immediately (if COD or payment completed)
    // Always send emails after order is saved
    try {
      await sendOrderConfirmationEmails(order, buyer, farmer, product);
      console.log('Order confirmation emails sent successfully');
    } catch (emailError) {
      console.error('Email sending failed (order still created):', emailError);
      // Don't fail the order for email issues - order is already saved
    }

    res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      data: {
        orderId: order.orderId,
        order: {
          id: order._id,
          orderId: order.orderId,
          totalAmount: finalTotal,
          status: order.status
        }
      }
    });
  } catch (error) {
    console.error('Order creation error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
      productId: req.body?.productId,
      buyerId: req.userId,
      quantity: req.body?.quantity
    });
    
    // Provide more specific error messages
    let errorMessage = 'Failed to create order.';
    let statusCode = 500;
    
    if (error.name === 'ValidationError') {
      errorMessage = `Validation error: ${error.message}`;
      statusCode = 400;
    } else if (error.name === 'CastError') {
      errorMessage = 'Invalid product or user ID.';
      statusCode = 400;
    } else if (error.code === 11000) {
      errorMessage = 'Order already exists.';
      statusCode = 409;
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    res.status(statusCode).json({ 
      success: false, 
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        name: error.name
      } : undefined
    });
  }
});

// Create Razorpay Order
router.post('/orders/:orderId/payment', auth, buyerOnly, async (req, res) => {
  try {
    if (!razorpay) {
      return res.status(503).json({ 
        success: false, 
        message: 'Payment gateway is not configured.' 
      });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found.' 
      });
    }

    if (order.buyerId.toString() !== req.userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized.' 
      });
    }

    if (order.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: 'Order is not in pending state.' 
      });
    }

    // Create Razorpay order
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(order.totalAmount * 100), // Amount in paisa
      currency: 'INR',
      receipt: order.orderId,
      payment_capture: 1
    });

    // Update order with payment details
    order.paymentDetails.paymentId = razorpayOrder.id;
    order.paymentDetails.paymentMethod = 'razorpay';
    await order.save();

    res.json({
      success: true,
      data: {
        razorpayOrderId: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        key: process.env.RAZORPAY_KEY_ID
      }
    });
  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create payment.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Verify Payment
router.post('/orders/:orderId/payment/verify', auth, buyerOnly, async (req, res) => {
  try {
    if (!razorpay || !process.env.RAZORPAY_KEY_SECRET) {
      return res.status(503).json({ 
        success: false, 
        message: 'Payment gateway is not configured.' 
      });
    }

    const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;

    if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
      return res.status(400).json({ 
        success: false, 
        message: 'Payment verification details are required.' 
      });
    }

    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found.' 
      });
    }

    if (order.buyerId.toString() !== req.userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized.' 
      });
    }

    // Verify payment signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(sign.toString())
      .digest('hex');

    if (razorpay_signature !== expectedSign) {
      order.status = 'payment_failed';
      order.paymentDetails.paymentStatus = 'failed';
      await order.save();
      return res.status(400).json({ 
        success: false, 
        message: 'Payment verification failed.' 
      });
    }

    // Update order status
    order.status = 'confirmed';
    order.paymentDetails.transactionId = razorpay_payment_id;
    order.paymentDetails.paymentStatus = 'completed';
    order.paymentDetails.paidAt = new Date();
    await order.save();

    // Get buyer and farmer for email
    const buyer = await User.findById(order.buyerId);
    const farmer = await User.findById(order.farmerId);
    const product = await Product.findById(order.productId);

    // Send confirmation emails
    if (buyer && farmer && product) {
      try {
        await sendOrderConfirmationEmails(order, buyer, farmer, product);
      } catch (emailError) {
        console.error('Email sending failed:', emailError);
        // Don't fail the payment for email issues
      }
    }

    res.json({
      success: true,
      message: 'Payment verified and order confirmed.',
      data: {
        order: {
          id: order._id,
          orderId: order.orderId,
          status: order.status
        }
      }
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Payment verification failed.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get Buyer's Orders
router.get('/orders', auth, buyerOnly, async (req, res) => {
  try {
    const orders = await Order.find({ buyerId: req.userId })
      .populate('productId', 'name images category unit price')
      .populate('farmerId', 'name location phone email')
      .populate('buyerId', 'name phone email')
      .sort('-createdAt');

    res.json({
      success: true,
      data: {
        orders: orders.map(order => ({
          id: order._id,
          orderId: order.orderId,
          product: order.productId || order.productSnapshot,
          farmer: order.farmerId || order.farmerSnapshot,
          buyer: order.buyerId || order.buyerSnapshot,
          quantity: order.quantity,
          unitPrice: order.unitPrice,
          subtotalAmount: order.subtotalAmount,
          shippingAmount: order.shippingAmount,
          taxAmount: order.taxAmount,
          totalAmount: order.totalAmount,
          status: order.status,
          paymentDetails: order.paymentDetails,
          deliveryDetails: order.deliveryDetails,
          timeline: order.timeline,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt
        }))
      }
    });
  } catch (error) {
    console.error('Orders fetch error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch orders.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get Single Order
router.get('/orders/:orderId', auth, buyerOnly, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('productId', 'name images category unit price description')
      .populate('farmerId', 'name location phone email')
      .populate('buyerId', 'name phone email');

    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found.' 
      });
    }

    // Handle both populated and snapshot scenarios
    const buyerId = order.buyerId?._id?.toString() || order.buyerId?.toString() || order.buyerId?.id?.toString();
    
    if (buyerId !== req.userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized.' 
      });
    }

    res.json({
      success: true,
      data: {
        order: {
          id: order._id,
          orderId: order.orderId,
          product: order.productId || order.productSnapshot,
          farmer: order.farmerId || order.farmerSnapshot,
          buyer: order.buyerId || order.buyerSnapshot,
          quantity: order.quantity,
          unitPrice: order.unitPrice,
          subtotalAmount: order.subtotalAmount,
          shippingAmount: order.shippingAmount,
          taxAmount: order.taxAmount,
          totalAmount: order.totalAmount,
          status: order.status,
          paymentDetails: order.paymentDetails,
          deliveryDetails: order.deliveryDetails,
          timeline: order.timeline,
          rating: order.rating,
          notes: order.notes,
          cancellation: order.cancellation,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt
        }
      }
    });
  } catch (error) {
    console.error('Order fetch error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch order.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Cancel Order
router.patch('/orders/:orderId/cancel', auth, buyerOnly, async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ 
        success: false, 
        message: 'Order not found.' 
      });
    }

    // Handle both populated and snapshot scenarios
    const buyerId = order.buyerId?._id?.toString() || order.buyerId?.toString() || order.buyerId?.id?.toString();
    
    if (buyerId !== req.userId.toString()) {
      return res.status(403).json({ 
        success: false, 
        message: 'Not authorized.' 
      });
    }

    if (!order.canBeCancelled()) {
      return res.status(400).json({ 
        success: false, 
        message: 'Order cannot be cancelled at this stage.' 
      });
    }

    const refundAmount = order.calculateRefundAmount();
    order.status = 'cancelled';
    order.cancellation = {
      cancelledBy: 'buyer',
      reason: req.body.reason || 'Cancelled by buyer',
      cancelledAt: new Date(),
      refundAmount,
      refundStatus: refundAmount > 0 ? 'pending' : 'not_applicable'
    };
    
    // Update payment status
    if (order.paymentDetails.paymentStatus === 'completed') {
      order.paymentDetails.paymentStatus = 'refunded';
    }
    
    await order.save();

    // Restore product quantity
    const product = await Product.findById(order.productId);
    if (product) {
      product.quantity += order.quantity;
      if (product.quantity > 0 && !product.isActive) {
        product.isActive = true;
      }
      await product.save();
    }

    res.json({
      success: true,
      message: 'Order cancelled successfully.',
      data: {
        refundAmount,
        orderId: order.orderId,
        status: order.status
      }
    });
  } catch (error) {
    console.error('Order cancellation error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to cancel order.',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Helper function to send order confirmation emails
async function sendOrderConfirmationEmails(order, buyer, farmer, product) {
  try {
    // Calculate subtotal and tax
    const subtotal = order.totalAmount / 1.18; // Remove 18% GST
    const tax = order.totalAmount - subtotal; // 18% GST amount

    // Format payment method
    const paymentMethodMap = {
      'cod': 'Cash on Delivery (COD)',
      'razorpay': 'Online Payment (Razorpay)',
      'demo_payment': 'Demo Payment',
      'upi': 'UPI Payment',
      'card': 'Card Payment',
      'netbanking': 'Net Banking'
    };
    const paymentMethodName = paymentMethodMap[order.paymentDetails.paymentMethod] || 'Online Payment';

    // Format delivery address
    const deliveryAddr = order.deliveryDetails.address;
    let formattedAddress = '';
    if (typeof deliveryAddr === 'string') {
      formattedAddress = deliveryAddr;
    } else if (deliveryAddr && typeof deliveryAddr === 'object') {
      const addrParts = [];
      if (deliveryAddr.street) addrParts.push(deliveryAddr.street);
      if (deliveryAddr.addressLine2) addrParts.push(deliveryAddr.addressLine2);
      if (deliveryAddr.city || deliveryAddr.state || deliveryAddr.pincode) {
        const location = [deliveryAddr.city, deliveryAddr.state, deliveryAddr.pincode].filter(Boolean).join(', ');
        if (location) addrParts.push(location);
      }
      formattedAddress = addrParts.join(', ') || 'Address to be confirmed';
    }

    // Prepare order data for buyer email
    const orderData = {
      orderId: order.orderId,
      buyerName: buyer.name || 'Demo Buyer',
      buyerEmail: buyer.email || 'demo@buyer.com',
      buyerPhone: buyer.phone || '+91 9999999999',
      buyerAddress: formattedAddress,
      farmerName: farmer.name,
      farmerEmail: farmer.email,
      farmerPhone: farmer.phone || 'N/A',
      farmerAddress: farmer.location?.address || 'Farm Location',
      items: [{
        name: product.name,
        quantity: order.quantity,
        unit: product.unit,
        price: order.unitPrice.toFixed(2),
        total: subtotal.toFixed(2)
      }],
      subtotal: subtotal.toFixed(2),
      tax: tax.toFixed(2),
      total: order.totalAmount.toFixed(2),
      paymentMethod: paymentMethodName,
      transactionId: order.paymentDetails.transactionId || null,
      paymentDate: order.paymentDetails.paidAt 
        ? new Date(order.paymentDetails.paidAt).toLocaleDateString('en-IN')
        : new Date().toLocaleDateString('en-IN'),
      invoiceNumber: order.orderId,
      orderDate: order.createdAt.toLocaleDateString('en-IN'),
      paymentStatus: order.paymentDetails.paymentMethod === 'cod' ? 'Pending (COD)' : 'Paid'
    };

    // Send invoice to buyer
    console.log('Sending invoice email to buyer:', orderData.buyerEmail);
    await mailerService.sendEmail('invoice', orderData.buyerEmail, orderData, {
      subject: `Order Invoice - ${order.orderId}`,
      category: 'invoice'
    });

    // Prepare sale notification data for farmer
    const saleData = {
      farmerName: farmer.name,
      buyerName: orderData.buyerName,
      orderId: order.orderId,
      productName: product.name,
      quantity: order.quantity,
      unit: product.unit,
      unitPrice: order.unitPrice.toFixed(2),
      totalAmount: order.totalAmount.toFixed(2),
      paymentMethod: paymentMethodName,
      buyerPhone: orderData.buyerPhone,
      buyerEmail: orderData.buyerEmail,
      deliveryAddress: formattedAddress,
      expectedDelivery: 'Within 2-3 business days',
      timeSlot: order.deliveryDetails.deliveryTimeSlot || 'flexible',
      deliveryInstructions: order.notes?.buyerNotes || 'None',
      orderUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/farmer-dashboard.html`,
      dashboardUrl: `${process.env.BASE_URL || 'http://localhost:3000'}/farmer-dashboard.html`,
      baseUrl: process.env.BASE_URL || 'http://localhost:3000',
      year: new Date().getFullYear(),
      totalSalesCount: 'Multiple', // TODO: Calculate from database
      monthlyEarnings: '₹ 50,000+', // TODO: Calculate from database  
      farmerRating: '4.5★' // TODO: Calculate from database
    };

    // Send sale notification to farmer
    console.log('Sending sale notification email to farmer:', farmer.email);
    await mailerService.sendEmail('sale_notification', farmer.email, saleData, {
      subject: `New Order Received - ${order.orderId}`,
      category: 'sale_notification'
    });

    console.log('Emails sent successfully for order:', order.orderId);

  } catch (error) {
    console.error('Email sending error:', error);
    console.error('Error stack:', error.stack);
    // Don't throw error to avoid order failure
    throw error; // Re-throw so caller knows emails failed, but order is already saved
  }
}

module.exports = router;
