const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Order = require('../models/Order');
const Product = require('../models/Product');
const User = require('../models/User');
const mailerService = require('../services/mailer');
const logger = require('../services/logger');
const mongoose = require('mongoose');

router.post('/', auth, async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const {
            productId,
            quantity,
            shippingAddress,
            paymentMethod,
            pricing = {},
            escrow
        } = req.body;

        // Validate the product exists and has enough stock
        const product = await Product.findById(productId).session(session);
        if (!product) {
            throw new Error('Product not found');
        }

        if (product.quantity < quantity) {
            throw new Error('Not enough stock available');
        }

        if (quantity < product.minOrderQuantity) {
            throw new Error(`Minimum order quantity is ${product.minOrderQuantity}`);
        }

        // Server-side pricing calculation for validation
        const calculatedSubtotal = product.price * quantity;
        const calculatedShipping = calculatedSubtotal >= 500 ? 0 : 50;
        const taxRate = 0.18;
        const calculatedTax = calculatedSubtotal * taxRate;
        const calculatedTotal = calculatedSubtotal + calculatedShipping + calculatedTax;

        const pricingSnapshot = {
            unitPrice: pricing.unitPrice ?? product.price,
            quantity: pricing.quantity ?? quantity,
            subtotal: pricing.subtotal ?? calculatedSubtotal,
            shipping: pricing.shipping ?? calculatedShipping,
            tax: pricing.tax ?? calculatedTax,
            total: pricing.total ?? calculatedTotal,
            clientSubtotal: pricing.subtotal,
            clientShipping: pricing.shipping,
            clientTax: pricing.tax,
            clientTotal: pricing.total,
            mismatchDetected: false
        };

        const mismatchFields = [];

        if (typeof pricing.total === 'number' && Math.abs(pricing.total - calculatedTotal) > 0.5) {
            mismatchFields.push('total');
        }

        if (typeof pricing.subtotal === 'number' && Math.abs(pricing.subtotal - calculatedSubtotal) > 0.5) {
            mismatchFields.push('subtotal');
        }

        if (typeof pricing.tax === 'number' && Math.abs(pricing.tax - calculatedTax) > 0.5) {
            mismatchFields.push('tax');
        }

        if (typeof pricing.shipping === 'number' && Math.abs(pricing.shipping - calculatedShipping) > 0.5) {
            mismatchFields.push('shipping');
        }

        if (mismatchFields.length > 0) {
            pricingSnapshot.mismatchDetected = true;
            pricingSnapshot.mismatchReason = `Mismatch detected in fields: ${mismatchFields.join(', ')}`;

            logger.warn('Order pricing mismatch detected', {
                context: 'order_creation',
                buyerId: req.userId,
                productId,
                mismatchFields,
                clientPricing: pricing,
                calculatedPricing: {
                    subtotal: calculatedSubtotal,
                    shipping: calculatedShipping,
                    tax: calculatedTax,
                    total: calculatedTotal
                }
            });
        }

        const [buyer, farmer] = await Promise.all([
            User.findById(req.userId).select('name email phone location').session(session),
            User.findById(product.farmerId).select('name email').session(session)
        ]);

        if (!buyer) {
            throw new Error('Buyer not found');
        }

        if (!farmer) {
            throw new Error('Farmer not found');
        }

        const shippingSource = typeof shippingAddress === 'string' ? { addressLine1: shippingAddress } : (shippingAddress || {});
        const location = buyer.location || {};
        const normalizedAddress = {
            street: shippingSource.addressLine1 ?? shippingSource.street ?? shippingSource.address ?? location.address ?? '',
            city: shippingSource.city ?? location.city ?? '',
            state: shippingSource.state ?? location.state ?? '',
            pincode: shippingSource.pincode ?? location.pincode ?? '',
            landmark: shippingSource.addressLine2 ?? shippingSource.landmark ?? location.landmark ?? ''
        };

        if (normalizedAddress.pincode !== '') {
            normalizedAddress.pincode = String(normalizedAddress.pincode);
        }

        if (!normalizedAddress.street || !normalizedAddress.city || !normalizedAddress.state || !normalizedAddress.pincode) {
            throw new Error('Incomplete shipping address provided');
        }

        const order = new Order({
            buyerId: req.userId,
            farmerId: product.farmerId,
            productId,
            quantity,
            unitPrice: product.price,
            subtotalAmount: pricingSnapshot.subtotal,
            shippingAmount: pricingSnapshot.shipping,
            taxAmount: pricingSnapshot.tax,
            totalAmount: pricingSnapshot.total,
            pricingSnapshot,
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
                sku: product.sku,
                category: product.category
            },
            deliveryDetails: {
                address: normalizedAddress
            },
            paymentDetails: {
                paymentMethod,
                paymentStatus: paymentMethod === 'cod' ? 'pending' : 'completed'
            },
            status: paymentMethod === 'cod' ? 'pending' : 'confirmed'
        });

        if (escrow?.isEscrow) {
            order.escrowStatus = escrow.releaseStatus || 'on_hold';
            order.paymentDetails.escrow = {
                isEscrow: true,
                adminHoldAmount: escrow.adminHoldAmount ?? pricingSnapshot.total,
                releaseStatus: escrow.releaseStatus || 'pending',
                releaseRequestedAt: escrow.releaseRequestedAt,
                releaseRequestChannel: escrow.releaseRequestChannel,
                releaseNotes: escrow.releaseNotes
            };

            if (escrow.timelineEntry) {
                order.escrowTimeline = [{
                    status: escrow.timelineEntry.status,
                    note: escrow.timelineEntry.note,
                    performedBy: req.userId
                }];
            }
        }

        await order.save({ session });

        product.quantity -= quantity;
        await product.save({ session });

        const invoiceUrl = await generateInvoice(order, buyer, product);
        order.invoice = invoiceUrl;
        await order.save({ session });

        await session.commitTransaction();

        await Promise.all([
            mailerService.sendEmail('order_confirmation', buyer.email, {
                orderId: order._id,
                buyerName: buyer.name,
                productName: product.name,
                quantity: quantity,
                total: pricingSnapshot.total,
                invoiceUrl: invoiceUrl
            }),
            mailerService.sendEmail('sale_notification', farmer.email, {
                orderId: order._id,
                buyerName: buyer.name,
                productName: product.name,
                quantity: quantity,
                total: pricingSnapshot.total
            })
        ]);

        res.status(201).json({
            success: true,
            message: 'Order placed successfully',
            data: {
                orderId: order.orderId,
                invoiceUrl: invoiceUrl,
                pricing: pricingSnapshot
            }
        });

    } catch (error) {
        await session.abortTransaction();
        logger.error('Order creation error', {
            context: 'order_creation',
            buyerId: req.userId,
            productId: req.body?.productId,
            error: error.message,
            stack: error.stack
        });
        res.status(400).json({
            success: false,
            message: error.message || 'Failed to create order'
        });
    } finally {
        session.endSession();
    }
});

async function generateInvoice(order, buyer, product) {
    // Implement invoice generation logic here
    // For now, return a dummy URL
    return `/invoices/${order._id}.pdf`;
}

router.get('/buyer', auth, async (req, res) => {
    try {
        const orders = await Order.find({ buyer: req.userId })
            .populate('product', 'name price unit images')
            .populate('farmer', 'name')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: orders
        });
    } catch (error) {
        console.error('Error fetching buyer orders:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch orders'
        });
    }
});

router.get('/:orderId', auth, async (req, res) => {
    try {
        const order = await Order.findOne({
            _id: req.params.orderId,
            buyer: req.userId
        })
        .populate('product')
        .populate('farmer', 'name');

        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }

        res.json({
            success: true,
            data: order
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch order details'
        });
    }
});

module.exports = router;