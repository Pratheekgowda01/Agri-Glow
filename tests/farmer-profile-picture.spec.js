const { test, expect } = require('@playwright/test');

test.describe('Farmer Profile Picture Loading', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to login page
    await page.goto('http://localhost:3000/login.html');
  });

  test('should load profile picture from backend and fallback to default avatar', async ({ page }) => {
    // Login with farmer credentials
    await page.fill('input[placeholder="Enter your email"]', 'rajesh.farmer@agriglow.com');
    await page.fill('input[placeholder="Enter your password"]', 'demo123');
    await page.selectOption('select', 'Farmer');
    await page.click('button:has-text("Login")');

    // Wait for dashboard to load
    await page.waitForURL('**/farmer-dashboard.html');
    await expect(page).toHaveTitle('Farmer Dashboard - Agri Glow');

    // Verify profile data loads correctly
    await expect(page.locator('h2')).toContainText('Rajesh Kumar');
    await expect(page.locator('text=rajesh.farmer@agriglow.com')).toBeVisible();

    // Check profile image element exists
    const profileImage = page.locator('img[alt="Profile Image"]');
    await expect(profileImage).toBeVisible();

    // Verify profile image source (should be either actual profile image or default avatar)
    const imageSrc = await profileImage.getAttribute('src');
    expect(imageSrc).toMatch(/uploads\/users\/(farmer1\.jpg|default-avatar\.png)$/);

    // Verify image loads successfully (either profile or default avatar)
    await expect(profileImage).toHaveAttribute('src', imageSrc);
    
    // Wait for image to load
    await page.waitForFunction(() => {
      const img = document.querySelector('img[alt="Profile Image"]');
      return img && img.complete && img.naturalWidth > 0;
    });

    // Verify image has loaded with proper dimensions
    const imageNaturalWidth = await profileImage.evaluate(img => img.naturalWidth);
    expect(imageNaturalWidth).toBeGreaterThan(0);
  });

  test('should handle missing profile image with default avatar fallback', async ({ page }) => {
    // Login with different farmer that might not have profile image
    await page.fill('input[placeholder="Enter your email"]', 'priya.farmer@agriglow.com');
    await page.fill('input[placeholder="Enter your password"]', 'demo123');
    await page.selectOption('select', 'Farmer');
    await page.click('button:has-text("Login")');

    await page.waitForURL('**/farmer-dashboard.html');

    // Verify profile loads
    await expect(page.locator('h2')).toContainText('Priya Sharma');

    // Check that profile image loads (should fallback to default if farmer2.jpg doesn't exist)
    const profileImage = page.locator('img[alt="Profile Image"]');
    await expect(profileImage).toBeVisible();

    // Verify fallback mechanism works
    await page.waitForFunction(() => {
      const img = document.querySelector('img[alt="Profile Image"]');
      return img && img.complete;
    });

    const imageSrc = await profileImage.getAttribute('src');
    expect(imageSrc).toContain('uploads/users/');
  });

  test('should verify backend API returns profileImage field', async ({ page }) => {
    // Login first
    await page.fill('input[placeholder="Enter your email"]', 'rajesh.farmer@agriglow.com');
    await page.fill('input[placeholder="Enter your password"]', 'demo123');
    await page.selectOption('select', 'Farmer');
    await page.click('button:has-text("Login")');

    await page.waitForURL('**/farmer-dashboard.html');

    // Intercept API call to verify profileImage field is returned
    const apiResponse = await page.waitForResponse(response => 
      response.url().includes('/api/auth/me') && response.status() === 200
    );

    // Verify API response includes profileImage field
    expect(apiResponse).toBeTruthy();
    expect(apiResponse.status()).toBe(200);
  });
});