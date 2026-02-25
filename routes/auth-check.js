const express = require('express');
const { auth } = require('../middleware/auth');
const router = express.Router();

router.get('/check', auth, async (req, res) => {
    try {
        // Return minimal user info needed for dashboard access
        return res.json({
            success: true,
            data: {
                id: req.user._id,
                role: req.user.role,
                name: req.user.name,
                isAuthenticated: true
            }
        });
    } catch (error) {
        console.error('Auth check error:', error);
        return res.status(401).json({
            success: false,
            message: 'Authentication failed'
        });
    }
});

// Check admin authentication specifically
router.get('/check-admin', auth, async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin';
        return res.json({
            success: true,
            isAdmin,
            data: {
                id: req.user._id,
                role: req.user.role,
                name: req.user.name,
                isAuthenticated: true
            }
        });
    } catch (error) {
        console.error('Admin auth check error:', error);
        return res.status(401).json({
            success: false,
            message: 'Authentication failed',
            isAdmin: false
        });
    }
});

module.exports = router;