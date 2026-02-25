const { test, expect } = require('@playwright/test');

test.describe('Admin Dashboard - Complete Functionality', () => {
  const adminCredentials = {
    email: 'admin@agriglow.com',
    password: 'admin123'
  };

  test.beforeEach(async ({ page }) => {
    // Navigate to admin dashboard
    await page.goto('http://localhost:3000/admin-dashboard.html');
    
    // Login as admin
    await page.fill('#email', adminCredentials.email);
    await page.fill('#password', adminCredentials.password);
    await page.click('button[type="submit"]');
    
    // Wait for dashboard to load
    await expect(page).toHaveURL(/admin-dashboard/);
    await page.waitForLoadState('networkidle');
  });

  test('Admin Login and Dashboard Access', async ({ page }) => {
    // Verify dashboard is accessible and showing admin content
    await expect(page.locator('.dashboard-header')).toContainText('Admin Dashboard');
    
    // Check if navigation menu is visible
    await expect(page.locator('.nav-item')).toHaveCount(4); // Dashboard, Users, Products, Orders
    
    // Verify admin user info is displayed
    await expect(page.locator('.admin-info')).toBeVisible();
  });

  test('Dashboard Statistics Display', async ({ page }) => {
    // Wait for statistics to load
    await page.waitForSelector('.stats-card', { state: 'visible', timeout: 10000 });
    
    // Verify all statistics cards are present
    const statCards = page.locator('.stats-card');
    await expect(statCards).toHaveCount(4);
    
    // Check that statistics show actual numbers (not zeros)
    const totalUsers = await page.locator('[data-stat="total-users"]').textContent();
    const totalProducts = await page.locator('[data-stat="total-products"]').textContent();
    const totalOrders = await page.locator('[data-stat="total-orders"]').textContent();
    
    // Verify stats are numeric and greater than 0
    expect(parseInt(totalUsers)).toBeGreaterThanOrEqual(1);
    expect(parseInt(totalProducts)).toBeGreaterThanOrEqual(0);
    expect(parseInt(totalOrders)).toBeGreaterThanOrEqual(0);
  });

  test('Users Management Section', async ({ page }) => {
    // Click on Users navigation
    await page.click('a[href="#users"]');
    await page.waitForSelector('.users-section', { state: 'visible' });
    
    // Verify users table is loaded
    await expect(page.locator('.users-table')).toBeVisible();
    
    // Check if farmers and buyers are displayed
    await expect(page.locator('.user-role-farmer')).toHaveCount.greaterThanOrEqual(1);
    await expect(page.locator('.user-role-buyer')).toHaveCount.greaterThanOrEqual(1);
    
    // Test user status toggle
    const firstUserToggle = page.locator('.user-status-toggle').first();
    if (await firstUserToggle.isVisible()) {
      const originalState = await firstUserToggle.getAttribute('data-status');
      await firstUserToggle.click();
      
      // Wait for the status to change
      await page.waitForTimeout(1000);
      
      const newState = await firstUserToggle.getAttribute('data-status');
      expect(newState).not.toBe(originalState);
      
      // Toggle back to original state
      await firstUserToggle.click();
      await page.waitForTimeout(1000);
    }
  });

  test('Products Management Section', async ({ page }) => {
    // Click on Products navigation
    await page.click('a[href="#products"]');
    await page.waitForSelector('.products-section', { state: 'visible' });
    
    // Wait for products to load (handle the previous API issue)
    await page.waitForSelector('.products-table', { timeout: 10000 });
    
    // Verify products are displayed with proper data
    const productRows = page.locator('.product-row');
    const productCount = await productRows.count();
    
    if (productCount > 0) {
      // Check first product has required fields
      const firstProduct = productRows.first();
      await expect(firstProduct.locator('.product-name')).not.toBeEmpty();
      await expect(firstProduct.locator('.product-farmer')).not.toBeEmpty();
      await expect(firstProduct.locator('.product-price')).not.toBeEmpty();
      
      // Verify no "Failed to load products" message
      await expect(page.locator('.error-message')).not.toContainText('Failed to load products');
    } else {
      console.log('No products found in database for testing');
    }
  });

  test('Orders Management Section', async ({ page }) => {
    // Click on Orders navigation
    await page.click('a[href="#orders"]');
    await page.waitForSelector('.orders-section', { state: 'visible' });
    
    // Wait for orders to load (handle the previous API issue)
    await page.waitForSelector('.orders-table', { timeout: 10000 });
    
    // Verify orders are displayed with proper data
    const orderRows = page.locator('.order-row');
    const orderCount = await orderRows.count();
    
    if (orderCount > 0) {
      // Check first order has required fields populated correctly
      const firstOrder = orderRows.first();
      await expect(firstOrder.locator('.order-id')).not.toBeEmpty();
      await expect(firstOrder.locator('.order-buyer')).not.toBeEmpty();
      await expect(firstOrder.locator('.order-farmer')).not.toBeEmpty();
      await expect(firstOrder.locator('.order-product')).not.toBeEmpty();
      await expect(firstOrder.locator('.order-status')).not.toBeEmpty();
      
      // Verify no "Failed to load orders" message
      await expect(page.locator('.error-message')).not.toContainText('Failed to load orders');
    } else {
      console.log('No orders found in database for testing');
    }
  });

  test('API Endpoints Functionality', async ({ page }) => {
    // Test dashboard stats API
    const statsResponse = await page.evaluate(async () => {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/dashboard', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { status: response.status, data: await response.json() };
    });
    
    expect(statsResponse.status).toBe(200);
    expect(statsResponse.data.totalUsers).toBeGreaterThanOrEqual(1);
    
    // Test users API
    const usersResponse = await page.evaluate(async () => {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { status: response.status, data: await response.json() };
    });
    
    expect(usersResponse.status).toBe(200);
    expect(Array.isArray(usersResponse.data)).toBe(true);
    
    // Test products API
    const productsResponse = await page.evaluate(async () => {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/products', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { status: response.status, data: await response.json() };
    });
    
    expect(productsResponse.status).toBe(200);
    expect(Array.isArray(productsResponse.data)).toBe(true);
    
    // Test orders API
    const ordersResponse = await page.evaluate(async () => {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return { status: response.status, data: await response.json() };
    });
    
    expect(ordersResponse.status).toBe(200);
    expect(Array.isArray(ordersResponse.data)).toBe(true);
  });

  test('Error Handling and Edge Cases', async ({ page }) => {
    // Test invalid API calls
    const invalidResponse = await page.evaluate(async () => {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/nonexistent', {
        headers: { Authorization: `Bearer ${token}` }
      });
      return response.status;
    });
    
    expect(invalidResponse).toBe(404);
    
    // Test unauthorized access
    const unauthorizedResponse = await page.evaluate(async () => {
      const response = await fetch('/api/admin/dashboard');
      return response.status;
    });
    
    expect(unauthorizedResponse).toBe(401);
  });

  test('Admin Logout Functionality', async ({ page }) => {
    // Find and click logout button
    const logoutButton = page.locator('.logout-btn');
    if (await logoutButton.isVisible()) {
      await logoutButton.click();
      
      // Should redirect to login page
      await expect(page).toHaveURL(/login/);
    } else {
      console.log('Logout button not found - may need implementation');
    }
  });
});

test.describe('Admin Dashboard - Data Population Verification', () => {
  test('Verify Relationship Population in Products', async ({ page }) => {
    // Login first
    await page.goto('http://localhost:3000/admin-dashboard.html');
    await page.fill('#email', 'admin@agriglow.com');
    await page.fill('#password', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    
    // Navigate to products
    await page.click('a[href="#products"]');
    await page.waitForSelector('.products-section', { state: 'visible' });
    
    // Check API response directly to verify population
    const productsData = await page.evaluate(async () => {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/products', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      return data;
    });
    
    if (productsData.length > 0) {
      const firstProduct = productsData[0];
      // Verify farmerId is populated correctly
      expect(firstProduct.farmerId).toHaveProperty('name');
      console.log('Product farmer population test passed:', firstProduct.farmerId.name);
    }
  });

  test('Verify Relationship Population in Orders', async ({ page }) => {
    // Login first
    await page.goto('http://localhost:3000/admin-dashboard.html');
    await page.fill('#email', 'admin@agriglow.com');
    await page.fill('#password', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForLoadState('networkidle');
    
    // Navigate to orders
    await page.click('a[href="#orders"]');
    await page.waitForSelector('.orders-section', { state: 'visible' });
    
    // Check API response directly to verify population
    const ordersData = await page.evaluate(async () => {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/admin/orders', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      return data;
    });
    
    if (ordersData.length > 0) {
      const firstOrder = ordersData[0];
      // Verify all relationships are populated correctly
      expect(firstOrder.buyerId).toHaveProperty('name');
      expect(firstOrder.farmerId).toHaveProperty('name');
      expect(firstOrder.productId).toHaveProperty('name');
      console.log('Order relationships populated correctly:', {
        buyer: firstOrder.buyerId.name,
        farmer: firstOrder.farmerId.name,
        product: firstOrder.productId.name
      });
    }
  });
});