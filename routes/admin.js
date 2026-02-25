const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Order = require('../models/Order');
const Product = require('../models/Product');
const EmailLog = require('../models/EmailLog');
const { auth } = require('../middleware/auth');
const isAdmin = require('../middleware/isAdmin');

// Create combined middleware
const checkAdmin = async (req, res, next) => {
    try {
        await auth(req, res, async () => {
            await isAdmin(req, res, next);
        });
    } catch (error) {
        return res.status(401).json({ message: 'Authentication failed' });
    }
};

// Get Dashboard Stats (alternative endpoint name for compatibility)
router.get('/dashboard', checkAdmin, async (req, res) => {
    try {
        // Get counts and statistics
        const [
            userStats,
            productStats,
            orderStats,
            revenueStats
        ] = await Promise.all([
            User.aggregate([
                {
                    $group: {
                        _id: '$role',
                        count: { $sum: 1 }
                    }
                }
            ]),
            Product.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]),
            Order.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]),
            Order.aggregate([
                {
                    $match: {
                        status: 'Delivered'
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        revenue: { $sum: '$totalAmount' }
                    }
                }
            ])
        ]);

        // Format user stats
        const totalUsers = userStats.reduce((acc, curr) => acc + curr.count, 0);
        const totalFarmers = userStats.find(s => s._id === 'farmer')?.count || 0;
        const totalBuyers = userStats.find(s => s._id === 'buyer')?.count || 0;

        // Format product stats
        const totalProducts = productStats.reduce((acc, curr) => acc + curr.count, 0);
        const activeProducts = productStats.find(s => s._id === 'active')?.count || 0;

        // Format order stats
        const totalOrders = orderStats.reduce((acc, curr) => acc + curr.count, 0);
        const pendingOrders = orderStats.find(s => s._id === 'Pending')?.count || 0;

        // Format revenue stats
        const totalRevenue = revenueStats.reduce((acc, curr) => acc + curr.revenue, 0);

        res.json({ 
            totalUsers, 
            totalFarmers, 
            totalBuyers, 
            totalProducts, 
            activeProducts, 
            totalOrders, 
            pendingOrders, 
            totalRevenue 
        });
    } catch (error) {
        console.error('Admin dashboard error:', error);
        res.status(500).json({ message: 'Error fetching admin dashboard data' });
    }
});

// Get Dashboard Stats
router.get('/stats', checkAdmin, async (req, res) => {
    try {
        // Get counts and statistics
        const [
            userStats,
            productStats,
            orderStats,
            revenueStats
        ] = await Promise.all([
            User.aggregate([
                {
                    $group: {
                        _id: '$role',
                        count: { $sum: 1 }
                    }
                }
            ]),
            Product.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]),
            Order.aggregate([
                {
                    $group: {
                        _id: '$status',
                        count: { $sum: 1 }
                    }
                }
            ]),
            Order.aggregate([
                {
                    $match: {
                        status: 'Delivered'
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        revenue: { $sum: '$total' }
                    }
                }
            ])
        ]);

        // Format user stats
        const users = {
            total: userStats.reduce((acc, curr) => acc + curr.count, 0),
            farmers: userStats.find(s => s._id === 'farmer')?.count || 0,
            buyers: userStats.find(s => s._id === 'buyer')?.count || 0
        };

        // Format product stats
        const products = {
            total: productStats.reduce((acc, curr) => acc + curr.count, 0),
            active: productStats.find(s => s._id === 'active')?.count || 0
        };

        // Format order stats
        const orders = {
            total: orderStats.reduce((acc, curr) => acc + curr.count, 0),
            pending: orderStats.find(s => s._id === 'Pending')?.count || 0
        };

        // Format revenue stats
        const currentDate = new Date();
        const currentMonth = currentDate.getMonth() + 1;
        const currentYear = currentDate.getFullYear();

        const revenue = {
            total: revenueStats.reduce((acc, curr) => acc + curr.revenue, 0),
            monthly: revenueStats.find(r => 
                r._id.year === currentYear && 
                r._id.month === currentMonth
            )?.revenue || 0
        };

        res.json({ users, products, orders, revenue });
    } catch (error) {
        console.error('Admin stats error:', error);
        res.status(500).json({ message: 'Error fetching admin stats' });
    }
});

// Get All Users
router.get('/users', checkAdmin, async (req, res) => {
    try {
        const users = await User.find()
            .select('-password')
            .lean();
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// Get Users List by Role
router.get('/users/:role', checkAdmin, async (req, res) => {
    try {
        const users = await User.find({ role: req.params.role })
            .select('-password')
            .lean();
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching users' });
    }
});

// Update User Status
router.patch('/users/:id/status', checkAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isActive: req.body.isActive !== undefined ? req.body.isActive : (req.body.status === 'active') },
            { new: true }
        ).select('-password');
        res.json(user);
    } catch (error) {
        res.status(500).json({ message: 'Error updating user status' });
    }
});

// Get All Products
router.get('/products', checkAdmin, async (req, res) => {
    try {
        const products = await Product.find()
            .populate('farmerId', 'name')
            .lean();
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ message: 'Error fetching products' });
    }
});

// Update Product Status
router.patch('/products/:id/status', checkAdmin, async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { status: req.body.status },
            { new: true }
        );
        res.json(product);
    } catch (error) {
        res.status(500).json({ message: 'Error updating product status' });
    }
});

// Get All Orders
router.get('/orders', checkAdmin, async (req, res) => {
    try {
        const orders = await Order.find()
            .populate('buyerId', 'name email')
            .populate('farmerId', 'name email')
            .populate('productId', 'name category')
            .lean();
        res.json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ message: 'Error fetching orders' });
    }
});

// Update Order Status
router.patch('/orders/:id/status', checkAdmin, async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            { status: req.body.status },
            { new: true }
        );
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error updating order status' });
    }
});

// Get Email Logs
router.get('/email-logs', checkAdmin, async (req, res) => {
    try {
        const logs = await EmailLog.find()
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();
        res.json(logs);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching email logs' });
    }
});

// Get Email Log Details
router.get('/email-logs/:id', checkAdmin, async (req, res) => {
    try {
        const log = await EmailLog.findById(req.params.id).lean();
        res.json(log);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching email log' });
    }
});

// Get Disputes (orders with dispute flags)
router.get('/disputes', checkAdmin, async (req, res) => {
    try {
        const disputes = await Order.find({
            $or: [
                { disputeStatus: { $exists: true, $ne: null } },
                { hasDispute: true }
            ]
        })
        .populate('buyer', 'name email')
        .populate('products.product', 'name')
        .lean();
        res.json(disputes);
    } catch (error) {
        console.error('Error fetching disputes:', error);
        res.status(500).json({ message: 'Error fetching disputes' });
    }
});

// Handle Disputes
router.patch('/disputes/:id', checkAdmin, async (req, res) => {
    try {
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            {
                disputeStatus: req.body.status,
                disputeResolution: req.body.resolution
            },
            { new: true }
        );
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error updating dispute' });
    }
});

// Delete User (soft delete by setting status to inactive)
router.delete('/users/:id', checkAdmin, async (req, res) => {
    try {
        const user = await User.findByIdAndUpdate(
            req.params.id,
            { isActive: false, deletedAt: new Date() },
            { new: true }
        ).select('-password');
        res.json({ message: 'User deactivated successfully', user });
    } catch (error) {
        res.status(500).json({ message: 'Error deactivating user' });
    }
});

// Delete Product (soft delete)
router.delete('/products/:id', checkAdmin, async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { status: 'deleted', deletedAt: new Date() },
            { new: true }
        );
        res.json({ message: 'Product deleted successfully', product });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting product' });
    }
});

// Get detailed analytics
router.get('/analytics', checkAdmin, async (req, res) => {
    try {
        const [
            monthlyOrders,
            monthlyRevenue,
            topProducts,
            userGrowth
        ] = await Promise.all([
            // Monthly orders for the past 6 months
            Order.aggregate([
                {
                    $match: {
                        createdAt: { 
                            $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) 
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id.year': 1, '_id.month': 1 } }
            ]),
            
            // Monthly revenue for the past 6 months
            Order.aggregate([
                {
                    $match: {
                        status: 'Delivered',
                        createdAt: { 
                            $gte: new Date(new Date().setMonth(new Date().getMonth() - 6)) 
                        }
                    }
                },
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' }
                        },
                        revenue: { $sum: '$total' }
                    }
                },
                { $sort: { '_id.year': 1, '_id.month': 1 } }
            ]),
            
            // Top selling products
            Order.aggregate([
                { $unwind: '$products' },
                {
                    $group: {
                        _id: '$products.product',
                        totalSold: { $sum: '$products.quantity' },
                        revenue: { $sum: { $multiply: ['$products.price', '$products.quantity'] } }
                    }
                },
                { $sort: { totalSold: -1 } },
                { $limit: 10 },
                {
                    $lookup: {
                        from: 'products',
                        localField: '_id',
                        foreignField: '_id',
                        as: 'product'
                    }
                },
                { $unwind: '$product' }
            ]),
            
            // User growth over time
            User.aggregate([
                {
                    $group: {
                        _id: {
                            year: { $year: '$createdAt' },
                            month: { $month: '$createdAt' },
                            role: '$role'
                        },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { '_id.year': 1, '_id.month': 1 } }
            ])
        ]);
        
        res.json({
            monthlyOrders,
            monthlyRevenue, 
            topProducts,
            userGrowth
        });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ message: 'Error fetching analytics' });
    }
});

module.exports = router;