const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Product = require('./models/Product');
const Order = require('./models/Order');
require('dotenv').config();

const seedDemoData = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/agriglow', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Clear existing data
    await User.deleteMany({});
    await Product.deleteMany({});
    await Order.deleteMany({});
    
    console.log('Cleared existing data');
    
    // Create demo users
    const hashedPassword = await bcrypt.hash('demo123', 12);
    
    const users = [
      // Farmers
      {
        name: 'Rajesh Kumar',
        email: 'rajesh.farmer@agriglow.com',
        password: hashedPassword,
        role: 'farmer',
        phone: '+919876543210',
        location: {
          type: 'Point',
          coordinates: [77.1025, 28.7041], // Delhi coordinates
          address: 'Village Kharar, Sector 12, Delhi',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110001'
        },
        profileImage: '/uploads/users/farmer1.jpg',
        walletBalance: 15000,
        verified: true,
        profileComplete: true,
        isActive: true,
        ratings: { average: 4.5, count: 23 }
      },
      {
        name: 'Priya Sharma',
        email: 'priya.farmer@agriglow.com',
        password: hashedPassword,
        role: 'farmer',
        phone: '+919876543211',
        location: {
          type: 'Point',
          coordinates: [76.7794, 30.7333], // Chandigarh coordinates
          address: 'Village Morni Hills, Panchkula',
          city: 'Chandigarh',
          state: 'Punjab',
          pincode: '160001'
        },
        profileImage: '/uploads/users/farmer2.jpg',
        walletBalance: 22000,
        verified: true,
        profileComplete: true,
        isActive: true,
        ratings: { average: 4.8, count: 31 }
      },
      {
        name: 'Amit Singh',
        email: 'amit.farmer@agriglow.com',
        password: hashedPassword,
        role: 'farmer',
        phone: '+919876543212',
        location: {
          type: 'Point',
          coordinates: [75.7873, 30.9010], // Ludhiana coordinates
          address: 'Village Sahnewal, Ludhiana',
          city: 'Ludhiana',
          state: 'Punjab',
          pincode: '141001'
        },
        profileImage: '/uploads/users/farmer3.jpg',
        walletBalance: 18500,
        verified: true,
        profileComplete: true,
        isActive: true,
        ratings: { average: 4.2, count: 18 }
      },
      
      // Buyers
      {
        name: 'Neha Gupta',
        email: 'neha.buyer@agriglow.com',
        password: hashedPassword,
        role: 'buyer',
        phone: '+919876543213',
        location: {
          type: 'Point',
          coordinates: [77.2090, 28.6139], // Delhi coordinates
          address: 'CP Market, Connaught Place, Delhi',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110001'
        },
        profileImage: '/uploads/users/buyer1.jpg',
        walletBalance: 5000,
        verified: true,
        profileComplete: true,
        isActive: true,
        ratings: { average: 4.6, count: 12 }
      },
      {
        name: 'Rohit Verma',
        email: 'rohit.buyer@agriglow.com',
        password: hashedPassword,
        role: 'buyer',
        phone: '+919876543214',
        location: {
          type: 'Point',
          coordinates: [77.3910, 28.5355], // Gurgaon coordinates
          address: 'Cyber City, Gurgaon, Haryana',
          city: 'Gurgaon',
          state: 'Haryana',
          pincode: '122002'
        },
        profileImage: '/uploads/users/buyer2.jpg',
        walletBalance: 8000,
        verified: true,
        profileComplete: true,
        isActive: true,
        ratings: { average: 4.3, count: 8 }
      },
      
      // Admin
      {
        name: 'Admin User',
        email: 'admin@agriglow.com',
        password: hashedPassword,
        role: 'admin',
        phone: '+919876543215',
        location: {
          type: 'Point',
          coordinates: [77.1025, 28.7041],
          address: 'Agri Glow HQ, Delhi',
          city: 'Delhi',
          state: 'Delhi',
          pincode: '110001'
        },
        profileImage: '/uploads/users/admin.jpg',
        walletBalance: 0,
        verified: true,
        profileComplete: true,
        isActive: true,
        ratings: { average: 5.0, count: 1 }
      }
    ];
    
    console.log('Attempting to create users...');
    let createdUsers;
    try {
      createdUsers = await User.insertMany(users);
      console.log(`Created ${createdUsers.length} users`);
      createdUsers.forEach(user => {
        console.log(`- ${user.name} (${user.role}) - ID: ${user._id}`);
      });
    } catch (error) {
      console.error('Error creating users:', error);
      if (error.writeErrors) {
        error.writeErrors.forEach(err => {
          console.error(`User creation error:`, err);
        });
      }
      throw error;
    }
    
    // Get farmer IDs
    const farmers = createdUsers.filter(user => user.role === 'farmer');
    
    // Create demo products
    const currentDate = new Date();
    const futureDate = new Date();
    futureDate.setDate(currentDate.getDate() + 30);
    
    const products = [
      // Rajesh Kumar's products
      {
        farmerId: farmers[0]._id,
        name: 'Fresh Organic Tomatoes',
        description: 'Vine-ripened organic tomatoes, perfect for cooking and salads. No pesticides used.',
        category: 'vegetables',
        price: 45,
        unit: 'kg',
        quantity: 500,
        minOrderQuantity: 5,
        images: [{
          url: '/uploads/products/tomatoes.jpg',
          alt: 'Fresh organic tomatoes'
        }],
        isActive: true,
        isOrganic: true,
        harvestDate: new Date(currentDate.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
        expiryDate: futureDate,
        location: {
          address: 'Village Kharar, Delhi',
          coordinates: [77.1025, 28.7041]
        },
        ratings: { average: 4.5, count: 12 },
        tags: ['organic', 'fresh', 'local', 'vine-ripened']
      },
      {
        farmerId: farmers[0]._id,
        name: 'Premium Basmati Rice',
        description: 'Long grain premium basmati rice with excellent aroma and taste.',
        category: 'grains',
        price: 120,
        unit: 'kg',
        quantity: 1000,
        minOrderQuantity: 10,
        images: [{
          url: '/uploads/products/basmati-rice.jpg',
          alt: 'Premium basmati rice'
        }],
        isActive: true,
        isOrganic: false,
        harvestDate: new Date(currentDate.getTime() - 10 * 24 * 60 * 60 * 1000),
        expiryDate: new Date(currentDate.getTime() + 365 * 24 * 60 * 60 * 1000),
        location: {
          address: 'Village Kharar, Delhi',
          coordinates: [77.1025, 28.7041]
        },
        ratings: { average: 4.8, count: 25 },
        tags: ['premium', 'basmati', 'aromatic', 'long-grain']
      },
      {
        farmerId: farmers[0]._id,
        name: 'Fresh Spinach Leaves',
        description: 'Crisp and fresh spinach leaves, rich in iron and vitamins.',
        category: 'vegetables',
        price: 35,
        unit: 'kg',
        quantity: 150,
        minOrderQuantity: 2,
        images: [{
          url: '/uploads/products/spinach.jpg',
          alt: 'Fresh spinach leaves'
        }],
        isActive: true,
        isOrganic: true,
        harvestDate: new Date(currentDate.getTime() - 1 * 24 * 60 * 60 * 1000),
        expiryDate: new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000),
        location: {
          address: 'Village Kharar, Delhi',
          coordinates: [77.1025, 28.7041]
        },
        ratings: { average: 4.3, count: 8 },
        tags: ['organic', 'fresh', 'leafy-green', 'iron-rich']
      },
      
      // Priya Sharma's products
      {
        farmerId: farmers[1]._id,
        name: 'Sweet Mangoes (Alphonso)',
        description: 'King of mangoes! Sweet and juicy Alphonso mangoes from Maharashtra.',
        category: 'fruits',
        price: 280,
        unit: 'kg',
        quantity: 200,
        minOrderQuantity: 2,
        images: [{
          url: '/uploads/products/alphonso-mango.jpg',
          alt: 'Sweet Alphonso mangoes'
        }],
        isActive: true,
        isOrganic: false,
        harvestDate: new Date(currentDate.getTime() - 3 * 24 * 60 * 60 * 1000),
        expiryDate: new Date(currentDate.getTime() + 10 * 24 * 60 * 60 * 1000),
        location: {
          address: 'Village Morni Hills, Panchkula',
          coordinates: [76.7794, 30.7333]
        },
        ratings: { average: 4.9, count: 34 },
        tags: ['alphonso', 'sweet', 'juicy', 'premium']
      },
      {
        farmerId: farmers[1]._id,
        name: 'Pure Cow Milk',
        description: 'Fresh, pure cow milk from grass-fed cows. Rich in calcium and proteins.',
        category: 'dairy',
        price: 60,
        unit: 'litre',
        quantity: 100,
        minOrderQuantity: 2,
        images: [{
          url: '/uploads/products/cow-milk.jpg',
          alt: 'Pure cow milk'
        }],
        isActive: true,
        isOrganic: true,
        harvestDate: currentDate,
        expiryDate: new Date(currentDate.getTime() + 3 * 24 * 60 * 60 * 1000),
        location: {
          address: 'Village Morni Hills, Panchkula',
          coordinates: [76.7794, 30.7333]
        },
        ratings: { average: 4.7, count: 19 },
        tags: ['pure', 'grass-fed', 'calcium-rich', 'daily-fresh']
      },
      {
        farmerId: farmers[1]._id,
        name: 'Colorful Marigold Flowers',
        description: 'Beautiful orange and yellow marigold flowers for decoration and festivals.',
        category: 'flowers',
        price: 25,
        unit: 'kg',
        quantity: 50,
        minOrderQuantity: 1,
        images: [{
          url: '/uploads/products/marigold.jpg',
          alt: 'Colorful marigold flowers'
        }],
        isActive: true,
        isOrganic: true,
        harvestDate: currentDate,
        expiryDate: new Date(currentDate.getTime() + 5 * 24 * 60 * 60 * 1000),
        location: {
          address: 'Village Morni Hills, Panchkula',
          coordinates: [76.7794, 30.7333]
        },
        ratings: { average: 4.4, count: 7 },
        tags: ['colorful', 'festival', 'decoration', 'bright']
      },
      
      // Amit Singh's products
      {
        farmerId: farmers[2]._id,
        name: 'Fresh Potatoes',
        description: 'High-quality potatoes perfect for cooking various dishes.',
        category: 'vegetables',
        price: 25,
        unit: 'kg',
        quantity: 800,
        minOrderQuantity: 10,
        images: [{
          url: '/uploads/products/potatoes.jpg',
          alt: 'Fresh potatoes'
        }],
        isActive: true,
        isOrganic: false,
        harvestDate: new Date(currentDate.getTime() - 5 * 24 * 60 * 60 * 1000),
        expiryDate: new Date(currentDate.getTime() + 60 * 24 * 60 * 60 * 1000),
        location: {
          address: 'Village Sahnewal, Ludhiana',
          coordinates: [75.7873, 30.9010]
        },
        ratings: { average: 4.1, count: 15 },
        tags: ['versatile', 'cooking', 'staple', 'bulk']
      },
      {
        farmerId: farmers[2]._id,
        name: 'Sweet Corn',
        description: 'Tender and sweet corn perfect for boiling and grilling.',
        category: 'vegetables',
        price: 40,
        unit: 'piece',
        quantity: 300,
        minOrderQuantity: 5,
        images: [{
          url: '/uploads/products/sweet-corn.jpg',
          alt: 'Sweet corn'
        }],
        isActive: true,
        isOrganic: false,
        harvestDate: new Date(currentDate.getTime() - 1 * 24 * 60 * 60 * 1000),
        expiryDate: new Date(currentDate.getTime() + 14 * 24 * 60 * 60 * 1000),
        location: {
          address: 'Village Sahnewal, Ludhiana',
          coordinates: [75.7873, 30.9010]
        },
        ratings: { average: 4.6, count: 11 },
        tags: ['sweet', 'tender', 'grilling', 'boiling']
      },
      {
        farmerId: farmers[2]._id,
        name: 'Fresh Green Peas',
        description: 'Fresh green peas in pods, perfect for various Indian dishes.',
        category: 'vegetables',
        price: 55,
        unit: 'kg',
        quantity: 120,
        minOrderQuantity: 3,
        images: [{
          url: '/uploads/products/green-peas.jpg',
          alt: 'Fresh green peas'
        }],
        isActive: true,
        isOrganic: true,
        harvestDate: new Date(currentDate.getTime() - 1 * 24 * 60 * 60 * 1000),
        expiryDate: new Date(currentDate.getTime() + 10 * 24 * 60 * 60 * 1000),
        location: {
          address: 'Village Sahnewal, Ludhiana',
          coordinates: [75.7873, 30.9010]
        },
        ratings: { average: 4.4, count: 9 },
        tags: ['fresh', 'pods', 'protein-rich', 'seasonal']
      }
    ];
    
    const createdProducts = await Product.insertMany(products);
    console.log(`Created ${createdProducts.length} products`);
    
    // Create some demo orders
    const buyers = createdUsers.filter(user => user.role === 'buyer');
    const orders = [
      {
        orderId: 'AG1760693001DEF',
        buyerId: buyers[0]._id,
        farmerId: createdProducts[0].farmerId,
        productId: createdProducts[0]._id,
        quantity: 10,
        unitPrice: createdProducts[0].price,
        totalAmount: 450, // 10 * 45
        status: 'delivered',
        paymentDetails: {
          paymentMethod: 'razorpay',
          paymentStatus: 'completed',
          transactionId: 'txn_demo_001',
          paidAt: new Date(currentDate.getTime() - 6 * 24 * 60 * 60 * 1000)
        },
        deliveryDetails: {
          address: {
            street: 'CP Market, Connaught Place',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001'
          },
          coordinates: [77.2090, 28.6139],
          deliveryDate: new Date(currentDate.getTime() - 5 * 24 * 60 * 60 * 1000),
          deliveryTimeSlot: 'morning'
        },
        timeline: [
          {
            status: 'confirmed',
            timestamp: new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000),
            note: 'Order confirmed and payment received'
          },
          {
            status: 'processing',
            timestamp: new Date(currentDate.getTime() - 6 * 24 * 60 * 60 * 1000),
            note: 'Farmer is preparing the order'
          },
          {
            status: 'shipped',
            timestamp: new Date(currentDate.getTime() - 5.5 * 24 * 60 * 60 * 1000),
            note: 'Order shipped from farm'
          },
          {
            status: 'delivered',
            timestamp: new Date(currentDate.getTime() - 5 * 24 * 60 * 60 * 1000),
            note: 'Order delivered successfully'
          }
        ],
        rating: {
          productRating: 5,
          farmerRating: 5,
          review: 'Excellent quality tomatoes, very fresh!',
          reviewDate: new Date(currentDate.getTime() - 4 * 24 * 60 * 60 * 1000)
        }
      },
      {
        orderId: 'AG1760693002ABC',
        buyerId: buyers[1]._id,
        farmerId: createdProducts[3].farmerId,
        productId: createdProducts[3]._id,
        quantity: 5,
        unitPrice: createdProducts[3].price,
        totalAmount: 1400, // 5 * 280
        status: 'processing',
        paymentDetails: {
          paymentMethod: 'stripe',
          paymentStatus: 'completed',
          transactionId: 'pi_demo_002',
          paidAt: new Date(currentDate.getTime() - 2 * 24 * 60 * 60 * 1000)
        },
        deliveryDetails: {
          address: {
            street: 'Cyber City, Gurgaon',
            city: 'Gurgaon',
            state: 'Haryana',
            pincode: '122002'
          },
          coordinates: [77.3910, 28.5355],
          deliveryTimeSlot: 'evening',
          deliveryInstructions: 'Call before delivery'
        },
        timeline: [
          {
            status: 'confirmed',
            timestamp: new Date(currentDate.getTime() - 2 * 24 * 60 * 60 * 1000),
            note: 'Order confirmed and payment received'
          },
          {
            status: 'processing',
            timestamp: new Date(currentDate.getTime() - 1.5 * 24 * 60 * 60 * 1000),
            note: 'Mangoes being prepared for shipment'
          }
        ]
      },
      {
        orderId: 'AG1760693003XYZ',
        buyerId: buyers[0]._id,
        farmerId: createdProducts[6].farmerId,
        productId: createdProducts[6]._id,
        quantity: 20,
        unitPrice: createdProducts[6].price,
        totalAmount: 500, // 20 * 25
        status: 'shipped',
        paymentDetails: {
          paymentMethod: 'wallet',
          paymentStatus: 'completed',
          paidAt: new Date(currentDate.getTime() - 3 * 24 * 60 * 60 * 1000)
        },
        deliveryDetails: {
          address: {
            street: 'CP Market, Connaught Place',
            city: 'Delhi',
            state: 'Delhi',
            pincode: '110001'
          },
          coordinates: [77.2090, 28.6139],
          deliveryTimeSlot: 'afternoon',
          trackingId: 'TRK001234567'
        },
        timeline: [
          {
            status: 'confirmed',
            timestamp: new Date(currentDate.getTime() - 3 * 24 * 60 * 60 * 1000),
            note: 'Order confirmed, paid from wallet'
          },
          {
            status: 'processing',
            timestamp: new Date(currentDate.getTime() - 2.5 * 24 * 60 * 60 * 1000),
            note: 'Potatoes being packed'
          },
          {
            status: 'shipped',
            timestamp: new Date(currentDate.getTime() - 1 * 24 * 60 * 60 * 1000),
            note: 'Order shipped, tracking ID: TRK001234567'
          }
        ]
      }
    ];
    
    const createdOrders = await Order.insertMany(orders);
    console.log(`Created ${createdOrders.length} orders`);
    
    console.log('Demo data seeded successfully!');
    console.log('\n=== Demo User Credentials ===');
    console.log('Password for all users: demo123');
    console.log('\nFarmers:');
    console.log('- rajesh.farmer@agriglow.com (Delhi)');
    console.log('- priya.farmer@agriglow.com (Chandigarh)');
    console.log('- amit.farmer@agriglow.com (Ludhiana)');
    console.log('\nBuyers:');
    console.log('- neha.buyer@agriglow.com (Delhi)');
    console.log('- rohit.buyer@agriglow.com (Gurgaon)');
    console.log('\nAdmin:');
    console.log('- admin@agriglow.com');
    
  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed');
  }
};

// Run if called directly
if (require.main === module) {
  seedDemoData();
}

module.exports = seedDemoData;