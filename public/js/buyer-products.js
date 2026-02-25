let products = [];

async function loadProducts() {
    try {
        const token = localStorage.getItem('token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        
        const response = await fetch('/api/products', { headers });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to load products');
        }
        
        const data = await response.json();
        
        // Handle different response structures
        if (Array.isArray(data.data)) {
            products = data.data;
        } else if (Array.isArray(data.products)) {
            products = data.products;
        } else if (Array.isArray(data)) {
            products = data;
        } else {
            products = [];
            console.warn('Unexpected products response format:', data);
        }
        
        console.log(`Loaded ${products.length} products`);
        
        // Display products
        displayProducts();
        displayRecommendations();
        displayTrendingProducts();
        
    } catch (error) {
        console.error('Error loading products:', error);
        
        // Show error to user
        const container = document.getElementById('productsContainer');
        if (container) {
            container.innerHTML = `
                <div class="col-12">
                    <div class="empty-state">
                        <i class="bx bx-error-circle text-danger"></i>
                        <h4>Failed to load products</h4>
                        <p class="text-muted">${error.message || 'Please try refreshing the page.'}</p>
                        <button class="btn btn-success mt-3" onclick="loadProducts()">
                            <i class="bx bx-refresh"></i> Retry
                        </button>
                    </div>
                </div>`;
        }
        
        // Also clear recommendations and trending
        const recommendationsContainer = document.getElementById('recommendationsCarousel');
        if (recommendationsContainer) {
            recommendationsContainer.innerHTML = '<div class="empty-state py-4"><i class="bx bx-error-circle"></i><p class="text-muted mb-0">Failed to load recommendations</p></div>';
        }
        
        const trendingContainer = document.getElementById('trendingContainer');
        if (trendingContainer) {
            trendingContainer.innerHTML = '<div class="empty-state py-4"><i class="bx bx-error-circle"></i><p class="text-muted mb-0">Failed to load trending products</p></div>';
        }
    }
}

function displayProducts() {
    const container = document.getElementById('productsContainer');
    if (!container) {
        console.error('Products container not found!');
        return;
    }

    console.log(`Displaying ${products.length} products`);

    if (!Array.isArray(products) || products.length === 0) {
        container.innerHTML = `
            <div class="col-12">
                <div class="empty-state">
                    <i class="bx bx-package"></i>
                    <h4>No products available</h4>
                    <p class="text-muted">We're currently updating our inventory. Please check back soon!</p>
                </div>
            </div>`;
        return;
    }

    container.innerHTML = products.map(product => {
        const image = product.images?.[0]?.url || `/api/products/${product._id}/image` || 'https://via.placeholder.com/300x220/22c55e/ffffff?text=No+Image';
        const available = product.quantity > 0 && product.isActive !== false;
        const farmer = product.farmerId || product.farmer || {};
        const rating = product.ratings?.average || 0;
        const ratingCount = product.ratings?.count || 0;
        
        return `
        <div class="col-md-4 col-lg-3">
            <div class="card product-card h-100">
                ${product.isOrganic ? '<span class="badge bg-success status-badge"><i class="bx bx-leaf"></i> Organic</span>' : ''}
                ${!available ? '<span class="badge bg-danger status-badge">Out of Stock</span>' : ''}
                <img src="${image}" 
                     class="card-img-top" 
                     alt="${product.images?.[0]?.alt || product.name}"
                     onerror="this.src='https://via.placeholder.com/300x220/22c55e/ffffff?text=${encodeURIComponent(product.name || 'Product')}'">
                <div class="card-body d-flex flex-column">
                    <h5 class="card-title">${product.name || 'Unnamed Product'}</h5>
                    <p class="card-text text-muted small">${product.description || 'Fresh produce available now.'}</p>
                    
                    ${rating > 0 ? `
                    <div class="mb-2">
                        <span class="text-warning">
                            ${'★'.repeat(Math.floor(rating))}${rating % 1 >= 0.5 ? '☆' : ''}
                        </span>
                        <small class="text-muted ms-1">${rating.toFixed(1)} (${ratingCount})</small>
                    </div>
                    ` : ''}
                    
                    <div class="price-section">
                        <div>
                            <span class="price">₹${(product.price || 0).toLocaleString('en-IN')}</span>
                            <span class="unit">/${product.unit || 'unit'}</span>
                        </div>
                        <span class="stock-badge badge ${available ? 'badge-available' : 'bg-danger'}">
                            ${available ? 'In Stock' : 'Out of Stock'}
                        </span>
                    </div>
                    
                    <div class="mt-2">
                        <small class="text-muted d-block mb-2">
                            <i class="bx bx-user me-1"></i> ${farmer.name || 'Local Farmer'}
                        </small>
                        <div class="d-flex gap-2">
                            <button class="btn btn-outline-success flex-fill btn-sm" 
                                    onclick="viewProduct('${product._id}')">
                                <i class="bx bx-show"></i> View
                            </button>
                            <button class="btn btn-success flex-fill btn-sm" 
                                    onclick="initiateProductPurchase('${product._id}')"
                                    ${!available ? 'disabled' : ''}>
                                <i class="bx bx-cart"></i> Buy Now
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

function displayRecommendations() {
    const container = document.getElementById('recommendationsCarousel');
    if (!container) {
        return;
    }

    const safeProducts = Array.isArray(products) ? products : [];

    const recommended = safeProducts
        .filter(p => p?.quantity > 0)
        .slice(0, 5);

    if (recommended.length === 0) {
        container.innerHTML = '<div class="empty-state py-4"><i class="bx bx-star"></i><p class="text-muted mb-0">No recommendations available right now.</p></div>';
        return;
    }

    container.innerHTML = recommended.map(product => {
        const image = product.images?.[0]?.url || `/api/products/${product._id}/image` || 'https://via.placeholder.com/280x160/22c55e/ffffff?text=Product';
        const farmer = product.farmerId || product.farmer || {};
        
        return `
        <div class="recommendation-card">
            <img src="${image}" 
                 alt="${product.name || 'Product'}"
                 onerror="this.src='https://via.placeholder.com/280x160/22c55e/ffffff?text=${encodeURIComponent(product.name || 'Product')}'">
            <h6>${product.name || 'Fresh Produce'}</h6>
            <p class="text-muted small mb-2">${product.description || 'Quality produce from local farmers.'}</p>
            <div class="d-flex justify-content-between align-items-center mb-2">
                <div>
                    <span class="fw-bold text-primary fs-5">₹${(product.price || 0).toLocaleString('en-IN')}</span>
                    <small class="text-muted">/${product.unit || 'unit'}</small>
                </div>
                ${product.isOrganic ? '<span class="badge bg-success badge-sm"><i class="bx bx-leaf"></i></span>' : ''}
            </div>
            <small class="text-muted d-block mb-2">
                <i class="bx bx-user me-1"></i> ${farmer.name || 'Local Farmer'}
            </small>
            <button class="btn btn-success w-100" 
                    onclick="initiateProductPurchase('${product._id}')">
                <i class="bx bx-cart"></i> Buy Now
            </button>
        </div>
    `;
    }).join('');
}

function displayTrendingProducts() {
    const container = document.getElementById('trendingContainer');
    if (!container) {
        return;
    }

    const safeProducts = Array.isArray(products) ? products : [];

    const trending = safeProducts
        .filter(p => p?.quantity > 0)
        .sort((a, b) => (b?.ratings?.average || 0) - (a?.ratings?.average || 0))
        .slice(0, 6);

    if (trending.length === 0) {
        container.innerHTML = '<div class="empty-state py-4"><i class="bx bx-trending-up"></i><p class="text-muted mb-0">Trending products will appear here once available.</p></div>';
        return;
    }

    container.innerHTML = trending.map((product, index) => {
        const image = product.images?.[0]?.url || `/api/products/${product._id}/image` || 'https://via.placeholder.com/80x80/22c55e/ffffff?text=Product';
        const farmer = product.farmerId || product.farmer || {};
        const rating = product.ratings?.average || 0;
        
        return `
        <div class="trending-card">
            <div class="d-flex align-items-start gap-3">
                <div class="position-relative">
                    <img src="${image}" 
                         class="rounded" 
                         alt="${product.name || 'Product'}"
                         style="height: 100px; width: 100px; object-fit: cover;"
                         onerror="this.src='https://via.placeholder.com/100x100/22c55e/ffffff?text=${encodeURIComponent(product.name || 'Product')}'">
                    <span class="badge bg-danger position-absolute top-0 start-0 m-1">#${index + 1}</span>
                </div>
                <div class="flex-grow-1">
                    <h6 class="mb-1 fw-bold">${product.name || 'Fresh Produce'}</h6>
                    <p class="text-muted small mb-2">${product.description?.substring(0, 60) || 'Popular with other buyers.'}${product.description?.length > 60 ? '...' : ''}</p>
                    ${rating > 0 ? `
                    <div class="mb-2">
                        <span class="text-warning small">${'★'.repeat(Math.floor(rating))}</span>
                        <small class="text-muted">${rating.toFixed(1)}</small>
                    </div>
                    ` : ''}
                    <div class="d-flex justify-content-between align-items-center">
                        <div>
                            <span class="fw-bold text-primary">₹${(product.price || 0).toLocaleString('en-IN')}</span>
                            <small class="text-muted">/${product.unit || 'unit'}</small>
                        </div>
                        <button class="btn btn-sm btn-success" 
                                onclick="initiateProductPurchase('${product._id}')">
                            <i class="bx bx-cart"></i>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    }).join('');
}

// View product function (opens purchase modal)
async function viewProduct(productId) {
    if (typeof initiateProductPurchase === 'function') {
        await initiateProductPurchase(productId);
    } else {
        console.error('initiateProductPurchase function not found');
        alert('Unable to view product details. Please refresh the page.');
    }
}

// Make functions globally available for onclick handlers
window.viewProduct = viewProduct;
window.loadProducts = loadProducts;
