// auth-common.js - Common authentication functions for all dashboard pages

let isAuthenticating = false;
let lastAuthCheck = 0;
const AUTH_CHECK_INTERVAL = 5000; // 5 seconds

async function checkAuthentication(force = false) {
    // Prevent multiple simultaneous auth checks
    if (isAuthenticating) {
        console.log('Auth check already in progress, waiting...');
        // Wait for the current auth check to complete instead of returning false
        let attempts = 0;
        while (isAuthenticating && attempts < 10) {
            await new Promise(resolve => setTimeout(resolve, 500));
            attempts++;
        }
        // If still authenticating after waiting, something is wrong
        if (isAuthenticating) {
            console.error('Auth check timeout, resetting flag');
            isAuthenticating = false;
        }
    }

    // Don't check too frequently unless forced
    const now = Date.now();
    if (!force && (now - lastAuthCheck) < AUTH_CHECK_INTERVAL) {
        return true;
    }

    let token = localStorage.getItem('token');
    let role = localStorage.getItem('role');

    // If token/role are missing, the user may have just been redirected from the login
    // page and the storage write might not have completed when this check runs.
    // Perform a short retry loop if the referrer was the login page to avoid a redirect loop.
    if (!token || !role) {
        try {
            const maxTries = 6;
            const delayMs = 100;
            let tries = 0;
            while ((tries < maxTries) && (!token || !role) && document.referrer.includes('login.html')) {
                // small await to give the login script time to set localStorage
                await new Promise(res => setTimeout(res, delayMs));
                token = localStorage.getItem('token');
                role = localStorage.getItem('role');
                tries += 1;
            }
        } catch (e) {
            // ignore and fall through to redirect
        }
    }

    if (!token || !role) {
        console.log('No token or role found');
        redirectToLogin();
        return false;
    }

    try {
        isAuthenticating = true;
        console.log('Starting auth check with token:', token ? token.substring(0, 20) + '...' : 'null');
        
        const response = await fetch('/api/auth/check', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('Auth check response status:', response.status);
        
        if (!response.ok) {
            const responseText = await response.text();
            console.error('Auth check failed:', response.status, responseText);
            throw new Error(`Auth check failed: ${response.status} - ${responseText}`);
        }

        const data = await response.json();
        lastAuthCheck = Date.now();
        
        // Store the authentication state
        localStorage.setItem('isAuthenticated', 'true');
        localStorage.setItem('lastAuthCheck', lastAuthCheck);
        
        // Verify role matches current page. If it doesn't, redirect to the correct dashboard
        const currentPageRaw = window.location.pathname.split('/').pop();
        const currentPage = currentPageRaw.replace(/\.html$/i, '');
        const expectedPageBase = `${data.data.role.toLowerCase()}-dashboard`;

        if (currentPage !== expectedPageBase) {
            console.log('Role mismatch or wrong dashboard URL, redirecting to correct dashboard');
            // Redirect to the correct dashboard (preserve origin)
            const redirectPath = `/${expectedPageBase}.html`;
            window.location.href = redirectPath;
            return false;
        }

        return true;
    } catch (error) {
        console.error('Authentication error:', error);
        console.error('Error details:', error.message, error.stack);
        redirectToLogin();
        return false;
    } finally {
        isAuthenticating = false;
    }
}

function redirectToLogin() {
    // Remove only authentication-related keys so we don't accidentally clear unrelated app state
    try {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        localStorage.removeItem('userId');
        localStorage.removeItem('isAuthenticated');
        localStorage.removeItem('lastAuthCheck');
    } catch (e) {
        // ignore storage errors
    }

    const currentPath = window.location.pathname;
    if (!currentPath.includes('login.html')) {
        window.location.href = '/login.html';
    }
}

// Function to make authenticated API calls
async function authenticatedFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    if (!token) {
        throw new Error('No authentication token found');
    }

    const defaultOptions = {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        }
    };

    const finalOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };

    try {
        const response = await fetch(url, finalOptions);
        
        if (response.status === 401) {
            // Token expired or invalid
            localStorage.clear();
            window.location.href = '/login.html';
            throw new Error('Authentication failed');
        }

        return response;
    } catch (error) {
        console.error('API call failed:', error);
        throw error;
    }
}

// Handle logout
function handleLogout() {
    localStorage.clear();
    window.location.href = '/login.html';
}

// Check authentication on page load
// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    // First check if we have valid auth data
    const lastCheck = parseInt(localStorage.getItem('lastAuthCheck')) || 0;
    const isAuthenticated = localStorage.getItem('isAuthenticated') === 'true';
    const now = Date.now();

    // Show content immediately if we have recent authentication
    if (isAuthenticated && (now - lastCheck) < 5000) {
        document.body.style.visibility = 'visible';
    }

    // Perform a fresh auth check
    try {
        const authValid = await checkAuthentication(true);
        if (authValid) {
            document.body.style.visibility = 'visible';
        }
    } catch (error) {
        console.error('Error during authentication check:', error);
        redirectToLogin();
    }

    // Add logout event listener if the logout button exists
    const logoutBtn = document.querySelector('.logout-btn, #logout-btn, [data-action="logout"]');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Set up periodic token check (every 5 minutes)
    setInterval(checkAuthentication, 5 * 60 * 1000);
});