const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

async function createAdminAccount() {
    try {
        // Connect to MongoDB
        await mongoose.connect('mongodb://localhost:27017/agriglow', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });

        // Check if admin exists
        const existingAdmin = await User.findOne({ role: 'admin' });
        if (existingAdmin) {
            console.log('Admin account already exists!');
            process.exit(0);
        }

        // Admin credentials
        const adminData = {
            name: 'System Admin',
            email: 'admin@agriglow.com',
            password: await bcrypt.hash('Admin@123', 10),
            phone: '0000000000',
            role: 'admin',
            verified: true,
            isActive: true,
            location: {
                type: 'Point',
                coordinates: [0, 0],
                address: 'System',
                city: 'System',
                state: 'System',
                pincode: '000000'
            }
        };

        // Create admin user
        const admin = new User(adminData);
        await admin.save();

        console.log('\n✅ Admin account created successfully!');
        console.log('\nLogin credentials:');
        console.log('Email: admin@agriglow.com');
        console.log('Password: Admin@123');
        console.log('\nPlease change the password after first login.');

    } catch (error) {
        console.error('Error creating admin:', error);
    } finally {
        await mongoose.disconnect();
    }
}

createAdminAccount();