let currentUser = null;
// Note: products and orders are defined in their respective modules
let refreshHandle = null;
const REFRESH_INTERVAL = 30000; // 30 seconds

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // First check authentication
        const isAuthenticated = await checkAuthentication();
        if (!isAuthenticated) {
            window.location.href = '/login.html';
            return;
        }

        // Initialize components
        initializeComponents();
        
        // Load initial data (with error handling to prevent one failure from blocking others)
        console.log('Loading initial data...');
        console.log('Available functions:', {
            loadProducts: typeof loadProducts,
            loadOrders: typeof loadOrders,
            loadUserProfile: typeof loadUserProfile
        });
        
        const loadPromises = [
            loadUserProfile().catch(err => {
                console.error('User profile load error:', err);
                return null;
            }),
            (typeof loadProducts === 'function' ? loadProducts() : Promise.resolve()).catch(err => {
                console.error('Products load error:', err);
                return null;
            }),
            (typeof loadOrders === 'function' ? loadOrders() : Promise.resolve()).catch(err => {
                console.error('Orders load error:', err);
                return null;
            })
        ];
        
        const results = await Promise.allSettled(loadPromises);
        console.log('All data loaded. Results:', results);
        
        // If products didn't load, try again after a short delay
        // Check if products array exists and has items
        setTimeout(() => {
            const productsContainer = document.getElementById('productsContainer');
            if (productsContainer && (productsContainer.children.length === 0 || productsContainer.textContent.includes('No products'))) {
                console.log('No products displayed, retrying...');
                if (typeof loadProducts === 'function') {
                    loadProducts().catch(err => console.error('Retry products load error:', err));
                }
            }
        }, 2000);

        // Setup refresh interval (if not already set)
        if (!refreshHandle) {
            refreshHandle = setInterval(() => {
                loadProducts();
            }, REFRESH_INTERVAL);
        }

        // Show the page
        document.body.style.visibility = 'visible';

    } catch (error) {
        console.error('Initialization error:', error);
        alert('Failed to initialize dashboard. Please try refreshing the page.');
    }
});

function initializeComponents() {
    // Initialize section handling
    document.querySelectorAll('[data-section]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            showSection(link.dataset.section);
        });
    });

    // Initialize logout handler
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.clear();
            window.location.href = '/login.html';
        });
    }

    // Initialize modals
    const modals = [
        'purchaseModal',
        'orderDetailsModal',
        'ratingModal'
    ];

    modals.forEach(modalId => {
        const modalEl = document.getElementById(modalId);
        if (modalEl) {
            new bootstrap.Modal(modalEl);
        }
    });
}

async function loadUserProfile() {
    try {
        const token = localStorage.getItem('token');
        if (!token) {
            console.warn('No token found for user profile');
            const userNameEl = document.getElementById('userName');
            if (userNameEl) userNameEl.textContent = 'User';
            return;
        }

        console.log('Loading user profile...');
        
        // Try /api/auth/me first (preferred endpoint)
        let response = await fetch('/api/auth/me', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        console.log('Profile response status:', response.status);

        // If that fails, try the alternative endpoint
        if (!response.ok) {
            console.log('Trying alternative endpoint...');
            response = await fetch('/api/auth/users/profile', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
        }

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('Profile load failed:', errorData);
            throw new Error(errorData.message || 'Failed to load profile');
        }

        const data = await response.json();
        console.log('Profile data received:', data);
        
        // Handle different response structures
        if (data.data?.user) {
            currentUser = data.data.user;
            console.log('Using data.data.user structure');
        } else if (data.data) {
            currentUser = data.data;
            console.log('Using data.data structure');
        } else if (data.user) {
            currentUser = data.user;
            console.log('Using data.user structure');
        } else {
            currentUser = data;
            console.log('Using direct data structure');
        }

        console.log('Current user set to:', currentUser);

        // Update UI with user info
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
            const userName = currentUser?.name || currentUser?.user?.name || 'User';
            userNameEl.textContent = userName;
            console.log('Updated userName element with:', userName);
        } else {
            console.error('userName element not found!');
        }

        // Pre-fill shipping info if available
        if (currentUser && currentUser.location) {
            const location = currentUser.location;
            const address = typeof location === 'object' ? location : { address: location };
            
            const fields = [
                { id: 'shippingName', value: currentUser.name || '' },
                { id: 'shippingPhone', value: currentUser.phone || '' },
                { id: 'shippingAddress1', value: address.address || address.street || '' },
                { id: 'shippingCity', value: address.city || location.city || '' },
                { id: 'shippingState', value: address.state || location.state || '' },
                { id: 'shippingPincode', value: address.pincode || location.pincode || '' }
            ];
            
            fields.forEach(field => {
                const element = document.getElementById(field.id);
                if (element) {
                    element.value = field.value;
                }
            });
        }

    } catch (error) {
        console.error('Failed to load user profile:', error);
        // Set default user name if fetch fails
        const userNameEl = document.getElementById('userName');
        if (userNameEl) {
            userNameEl.textContent = 'User';
        }
    }
}

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('section[id$="-section"]').forEach(section => {
        section.style.display = 'none';
    });

    // Show selected section
    const selectedSection = document.getElementById(`${sectionId}-section`);
    if (selectedSection) {
        selectedSection.style.display = 'block';
    }

    // Update navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    const activeLink = document.querySelector(`[data-section="${sectionId}"]`);
    if (activeLink) {
        activeLink.classList.add('active');
    }
}

// Error handling function
function showError(message) {
    const alertDiv = document.createElement('div');
    alertDiv.className = 'alert alert-danger alert-dismissible fade show';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    const container = document.querySelector('.container');
    if (container) {
        container.insertBefore(alertDiv, container.firstChild);
    }
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// Make functions globally available for onclick handlers
window.showSection = showSection;
window.loadProducts = loadProducts;
window.loadOrders = loadOrders;