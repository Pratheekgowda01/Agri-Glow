const mongoose = require('mongoose');
const User = require('./models/User');
require('dotenv').config();

async function findBuyers() {
    try {
        await mongoose.connect(process.env.DB_URI || 'mongodb://localhost:27017/agri-glow');
        console.log('Connected to MongoDB');

        const buyers = await User.find({ role: 'buyer' }).select('name email phone verified isActive');
        console.log('Found buyers:', buyers.length);
        buyers.forEach((buyer, i) => {
            console.log(`${i + 1}. ${buyer.name} (${buyer.email}) - Active: ${buyer.isActive}, Verified: ${buyer.verified}`);
        });

        await mongoose.disconnect();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

findBuyers();