const express = require('express');
const router = express.Router();
const mailer = require('../services/mailer');

router.post('/test-email', async (req, res) => {
    try {
        // Send a test email using the welcome template
        await mailer.sendEmail('welcome', process.env.SMTP_USER, {
            name: 'Test User',
            role: 'farmer',
            year: new Date().getFullYear()
        });
        
        res.json({ 
            success: true, 
            message: 'Test email sent successfully. Check your inbox and spam folder.',
            sentTo: process.env.SMTP_USER
        });
    } catch (error) {
        console.error('Error sending test email:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send test email', 
            error: error.message,
            details: error.stack
        });
    }
});

module.exports = router;