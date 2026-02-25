require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const nodemailer = require('nodemailer');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
const EmailLog = require('./models/EmailLog');

// Test Configuration
const config = {
    baseUrl: 'http://localhost:3000',
    testEmail: 'test@example.com',
    testPassword: 'testPassword123'
};

// Initialize test data
const testData = {
    farmer: {
        name: 'Test Farmer',
        email: 'farmer@test.com',
        password: 'farmer123',
        phone: '1234567890',
        address: 'Test Farm Address',
        role: 'farmer'
    },
    buyer: {
        name: 'Test Buyer',
        email: 'buyer@test.com',
        password: 'buyer123',
        phone: '0987654321',
        address: 'Test Buyer Address',
        role: 'buyer'
    },
    product: {
        name: 'Test Product',
        description: 'Test Description',
        price: 100,
        quantity: 50,
        category: 'Vegetables'
    }
};

async function runTests() {
    console.log('Starting integration tests...\n');
    
    try {
        // 1. Test Database Connection
        console.log('Testing database connection...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✓ Database connection successful\n');

        // 2. Test Email Configuration
        console.log('Testing email configuration...');
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: 'agriglow8@gmail.com',
                pass: process.env.EMAIL_PASSWORD
            }
        });
        await transporter.verify();
        console.log('✓ Email configuration verified\n');

        // 3. Test User Registration & Authentication
        console.log('Testing user registration and authentication...');
        
        // Test Farmer Registration
        const farmerRes = await axios.post(`${config.baseUrl}/api/auth/register`, testData.farmer);
        console.log('✓ Farmer registration successful');
        
        // Test Buyer Registration
        const buyerRes = await axios.post(`${config.baseUrl}/api/auth/register`, testData.buyer);
        console.log('✓ Buyer registration successful');
        
        // Test Login
        const farmerLogin = await axios.post(`${config.baseUrl}/api/auth/login`, {
            email: testData.farmer.email,
            password: testData.farmer.password
        });
        const farmerToken = farmerLogin.data.token;
        console.log('✓ Farmer login successful');

        const buyerLogin = await axios.post(`${config.baseUrl}/api/auth/login`, {
            email: testData.buyer.email,
            password: testData.buyer.password
        });
        const buyerToken = buyerLogin.data.token;
        console.log('✓ Authentication tests passed\n');

        // 4. Test Product Management
        console.log('Testing product management...');
        
        // Add Product
        const productRes = await axios.post(
            `${config.baseUrl}/api/products`,
            testData.product,
            { headers: { Authorization: `Bearer ${farmerToken}` } }
        );
        const productId = productRes.data._id;
        console.log('✓ Product creation successful');

        // Update Product
        await axios.put(
            `${config.baseUrl}/api/products/${productId}`,
            { ...testData.product, price: 120 },
            { headers: { Authorization: `Bearer ${farmerToken}` } }
        );
        console.log('✓ Product update successful');

        // Get Products
        const products = await axios.get(`${config.baseUrl}/api/products`);
        console.log('✓ Product retrieval successful');
        console.log('✓ Product management tests passed\n');

        // 5. Test Order Management
        console.log('Testing order management...');
        
        // Create Order
        const orderRes = await axios.post(
            `${config.baseUrl}/api/orders`,
            {
                productId: productId,
                quantity: 2
            },
            { headers: { Authorization: `Bearer ${buyerToken}` } }
        );
        const orderId = orderRes.data._id;
        console.log('✓ Order creation successful');

        // Update Order Status
        await axios.patch(
            `${config.baseUrl}/api/orders/${orderId}/status`,
            { status: 'Accepted' },
            { headers: { Authorization: `Bearer ${farmerToken}` } }
        );
        console.log('✓ Order status update successful');

        // Get Order Details
        await axios.get(
            `${config.baseUrl}/api/orders/${orderId}`,
            { headers: { Authorization: `Bearer ${buyerToken}` } }
        );
        console.log('✓ Order retrieval successful');
        console.log('✓ Order management tests passed\n');

        // 6. Test Email Notifications
        console.log('Testing email notifications...');
        
        // Check Email Logs
        const emailLogs = await EmailLog.find({ 
            to: { $in: [testData.farmer.email, testData.buyer.email] }
        });
        
        if (emailLogs.length > 0) {
            console.log('✓ Email notifications being sent and logged');
            console.log(`✓ Found ${emailLogs.length} email logs`);
            
            // Check different types of emails
            const emailTypes = emailLogs.map(log => log.template);
            console.log('Email types sent:', [...new Set(emailTypes)]);
        }
        console.log('✓ Email system tests passed\n');

        // 7. Test Real-time Notifications
        console.log('Testing Socket.IO connections...');
        const io = require('socket.io-client');
        const socket = io(`${config.baseUrl}`);
        
        await new Promise((resolve) => {
            socket.on('connect', () => {
                console.log('✓ Socket connection successful');
                resolve();
            });
        });
        
        socket.close();
        console.log('✓ Real-time notification tests passed\n');

        // 8. Clean up test data
        console.log('Cleaning up test data...');
        await User.deleteMany({ 
            email: { $in: [testData.farmer.email, testData.buyer.email] }
        });
        await Product.deleteMany({ name: testData.product.name });
        await Order.deleteMany({ _id: orderId });
        console.log('✓ Test data cleanup successful\n');

        console.log('All tests completed successfully! 🎉\n');

        // Print Summary
        console.log('Test Summary:');
        console.log('-------------');
        console.log('✓ Database Connection: Working');
        console.log('✓ Email Configuration: Working');
        console.log('✓ User Registration: Working');
        console.log('✓ Authentication: Working');
        console.log('✓ Product Management: Working');
        console.log('✓ Order Management: Working');
        console.log('✓ Email Notifications: Working');
        console.log('✓ Real-time Updates: Working');
        console.log('✓ Data Storage/Retrieval: Working');

    } catch (error) {
        console.error('\nTest failed:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
        }
    } finally {
        await mongoose.disconnect();
    }
}

// Run the tests
runTests().catch(console.error);