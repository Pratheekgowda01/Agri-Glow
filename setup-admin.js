const axios = require('axios');
const readline = require('readline');
const crypto = require('crypto');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Generate a secure admin key
const adminKey = crypto.randomBytes(32).toString('hex');

async function createAdmin() {
  console.log('\n=== AgriGlow Admin Setup ===\n');
  console.log('This script will help you create the admin account.\n');
  
  // Set the admin key in environment
  process.env.ADMIN_CREATE_KEY = adminKey;
  
  // Get admin credentials
  const email = await new Promise(resolve => {
    rl.question('Enter admin email: ', resolve);
  });
  
  const password = await new Promise(resolve => {
    rl.question('Enter admin password (min 8 characters): ', resolve);
  });
  
  try {
    const response = await axios.post('http://localhost:3000/api/auth/create-admin', {
      email,
      password,
      adminKey
    });

    if (response.data.success) {
      console.log('\n✅ Admin account created successfully!');
      console.log('\nYou can now log in with these credentials at /login.html');
    } else {
      console.error('\n❌ Failed to create admin account:', response.data.message);
    }
  } catch (error) {
    console.error('\n❌ Error:', error.response?.data?.message || error.message);
  }
  
  rl.close();
}

createAdmin().catch(console.error);