require('dotenv').config();
const mongoose = require('mongoose');
const { execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');

async function checkPrerequisites() {
    console.log('🔍 Checking prerequisites...\n');

    // 1. Check if .env exists
    try {
        console.log('Checking .env file...');
        await fs.access('.env');
        console.log('✅ .env file found\n');
    } catch (err) {
        console.error('❌ .env file not found');
        process.exit(1);
    }

    // 2. Check MongoDB
    try {
        console.log('Checking MongoDB connection...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB is running and connected\n');
    } catch (err) {
        console.error('❌ MongoDB connection failed:', err.message);
        console.error('Please make sure MongoDB is running');
        process.exit(1);
    }

    // 3. Check required directories
    const directories = ['logs', 'public/uploads/products', 'public/uploads/users'];
    console.log('Checking required directories...');
    for (const dir of directories) {
        try {
            await fs.access(dir);
        } catch {
            console.log(`Creating directory: ${dir}`);
            await fs.mkdir(dir, { recursive: true });
        }
    }
    console.log('✅ All required directories are ready\n');

    // 4. Check email configuration
    console.log('Checking email configuration...');
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        console.log('✅ Email configuration found\n');
    } else {
        console.warn('⚠️ Email configuration missing or incomplete\n');
    }

    console.log('🚀 All prerequisites checked! Starting server...\n');
}

// Start the application
async function startApp() {
    try {
        await checkPrerequisites();
        require('./server.js');
    } catch (err) {
        console.error('Failed to start the application:', err);
        process.exit(1);
    }
}

startApp();