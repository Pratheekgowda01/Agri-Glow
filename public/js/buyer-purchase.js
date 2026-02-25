// Global variables for purchase flow
let selectedProduct = null;
let purchaseModal = null;
let orderSuccessModal = null;

// Initialize modals when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const purchaseModalEl = document.getElementById('purchaseModal');
    const orderSuccessModalEl = document.getElementById('orderSuccessModal');
    
    if (purchaseModalEl) {
        purchaseModal = new bootstrap.Modal(purchaseModalEl);
    }
    if (orderSuccessModalEl) {
        orderSuccessModal = new bootstrap.Modal(orderSuccessModalEl);
    }
});

// Helper function to normalize product data
function normalizeProduct(productData) {
    return {
        _id: productData._id || productData.id,
        name: productData.name || 'Unnamed Product',
        description: productData.description || '',
        price: parseFloat(productData.price || 0),
        unit: productData.unit || 'unit',
        quantity: parseInt(productData.quantity || 0),
        minOrderQuantity: parseInt(productData.minOrderQuantity || 1),
        images: productData.images || [],
        category: productData.category || 'others',
        isActive: productData.isActive !== false,
        farmerId: productData.farmerId || productData.farmer?._id || productData.farmer?.id
    };
}

// Product and Order Management
async function initiateProductPurchase(productId) {
    try {
        const response = await fetch(`/api/products/${productId}`);
        if (!response.ok) throw new Error('Failed to fetch product details');
        
        const productResponse = await response.json();
        const productData = productResponse.data || productResponse.product;
        if (!productResponse.success || !productData) {
            throw new Error('Product data is unavailable');
        }

        selectedProduct = normalizeProduct(productData);

        // Populate modal with product details
        document.getElementById('modalProductDetails').innerHTML = `
            <div class="mb-2">
                <strong>${selectedProduct.name}</strong>
                <p class="text-muted mb-1">${selectedProduct.description || ''}</p>
                <p class="mb-1">Price: ₹${selectedProduct.price} per ${selectedProduct.unit}</p>
                <p class="mb-0">Available: ${selectedProduct.quantity} ${selectedProduct.unit}</p>
            </div>
        `;
        
        // Set quantity constraints
        const quantityInput = document.getElementById('orderQuantity');
        quantityInput.max = selectedProduct.quantity;
        quantityInput.min = selectedProduct.minOrderQuantity || 1;
        quantityInput.value = selectedProduct.minOrderQuantity || 1;
        
        document.getElementById('quantityHelp').textContent = 
            `Minimum order: ${selectedProduct.minOrderQuantity || 1} ${selectedProduct.unit}`;
        
        updateOrderSummary();
        
        // Ensure modal is initialized before showing
        if (!purchaseModal) {
            const purchaseModalEl = document.getElementById('purchaseModal');
            if (purchaseModalEl) {
                purchaseModal = new bootstrap.Modal(purchaseModalEl);
            }
        }
        
        if (purchaseModal) {
            purchaseModal.show();
        } else {
            console.error('Purchase modal not found');
            alert('Unable to open purchase dialog. Please refresh the page.');
        }
    } catch (error) {
        console.error('Error initiating purchase:', error);
        alert('Failed to load product details. Please try again.');
    }
}

function updateQuantity(change) {
    const quantityInput = document.getElementById('orderQuantity');
    const newValue = parseInt(quantityInput.value) + change;
    
    if (newValue >= quantityInput.min && newValue <= quantityInput.max) {
        quantityInput.value = newValue;
        updateOrderSummary();
    }
}

function updateOrderSummary() {
    if (!selectedProduct) return;
    
    const quantity = parseInt(document.getElementById('orderQuantity').value);
    const totals = calculateOrderTotals(selectedProduct.price, quantity);
    
    document.getElementById('subtotalAmount').textContent = `₹${totals.subtotal.toFixed(2)}`;
    document.getElementById('shippingAmount').textContent = `₹${totals.shipping.toFixed(2)}`;
    document.getElementById('taxAmount').textContent = `₹${totals.tax.toFixed(2)}`;
    document.getElementById('totalAmount').textContent = `₹${totals.total.toFixed(2)}`;
}

function calculateOrderTotals(unitPrice, quantity) {
    const subtotal = unitPrice * quantity;
    const taxRate = 0.18; // Keep in sync with backend (18% GST)
    const shipping = subtotal >= 500 ? 0 : 50; // Match backend shipping rules
    const tax = subtotal * taxRate;
    const total = subtotal + shipping + tax;
    
    return { subtotal, shipping, tax, total };
}

async function confirmPurchase() {
    if (!selectedProduct) return;
    
    const form = document.getElementById('purchaseForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    
    const quantity = parseInt(document.getElementById('orderQuantity').value);
    const orderTotals = calculateOrderTotals(selectedProduct.price, quantity);

    // Get payment method
    const paymentMethodEl = document.getElementById('paymentMethod');
    const paymentMethod = paymentMethodEl ? paymentMethodEl.value : 'cod';
    
    // Calculate total including COD charge if applicable
    const codCharge = (paymentMethod === 'cod') ? 50 : 0;
    const finalTotal = orderTotals.totalAmount + codCharge;
    
    const orderData = {
        productId: selectedProduct._id,
        quantity,
        shippingAddress: {
            name: document.getElementById('shippingName').value,
            phone: document.getElementById('shippingPhone').value,
            addressLine1: document.getElementById('shippingAddress1').value,
            addressLine2: document.getElementById('shippingAddress2').value,
            city: document.getElementById('shippingCity').value,
            state: document.getElementById('shippingState').value,
            pincode: document.getElementById('shippingPincode').value
        },
        paymentMethod: paymentMethod,
        totalAmount: finalTotal // Send total amount for verification
    };

    try {
        console.log('Sending order data:', {
            productId: orderData.productId,
            quantity: orderData.quantity,
            paymentMethod: orderData.paymentMethod,
            totalAmount: orderData.totalAmount,
            hasShippingAddress: !!orderData.shippingAddress
        });
        
        const response = await fetch('/api/buyer/orders', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify(orderData)
        });

        const responseData = await response.json().catch(() => ({}));
        console.log('Order response:', {
            status: response.status,
            ok: response.ok,
            data: responseData
        });

        if (!response.ok) {
            console.error('Order creation failed:', {
                status: response.status,
                statusText: response.statusText,
                error: responseData
            });
            throw new Error(responseData.message || responseData.error || 'Failed to place order');
        }
        
        const result = responseData;
        
        // Show success modal
        const successOrderIdEl = document.getElementById('successOrderId');
        if (successOrderIdEl) {
            successOrderIdEl.textContent = result.data?.orderId || result.orderId || 'N/A';
        }
        
        if (purchaseModal) {
            purchaseModal.hide();
        }
        
        // Ensure success modal is initialized before showing
        if (!orderSuccessModal) {
            const orderSuccessModalEl = document.getElementById('orderSuccessModal');
            if (orderSuccessModalEl) {
                orderSuccessModal = new bootstrap.Modal(orderSuccessModalEl);
            }
        }
        
        if (orderSuccessModal) {
            orderSuccessModal.show();
        } else {
            console.error('Order success modal not found');
        }
        
        // Refresh orders list
        if (typeof loadOrders === 'function') await loadOrders();
        if (typeof loadProducts === 'function') await loadProducts(); // Refresh product list to update stock
        
    } catch (error) {
        console.error('Error placing order:', error);
        alert(error.message || 'Failed to place order. Please try again.');
    }
}

function viewOrder() {
    if (orderSuccessModal) {
        orderSuccessModal.hide();
    }
    if (typeof showSection === 'function') {
        showSection('orders');
    } else {
        // Fallback: manually show orders section
        document.querySelectorAll('section[id$="-section"]').forEach(section => {
            section.style.display = 'none';
        });
        const ordersSection = document.getElementById('orders-section');
        if (ordersSection) {
            ordersSection.style.display = 'block';
        }
    }
}

// Make functions globally available for onclick handlers
window.initiateProductPurchase = initiateProductPurchase;
window.updateQuantity = updateQuantity;
window.updateOrderSummary = updateOrderSummary;
window.confirmPurchase = confirmPurchase;
window.viewOrder = viewOrder;

// Wait for DOM to be ready before setting up event listeners
document.addEventListener('DOMContentLoaded', function() {
    const paymentMethodEl = document.getElementById('paymentMethod');
    if (paymentMethodEl) {
        paymentMethodEl.addEventListener('change', function(e) {
            const detailsDiv = document.getElementById('paymentMethodDetails');
            if (!detailsDiv) return;
            
            const method = e.target.value;
            
            let html = '';
            switch(method) {
                case 'upi':
                    html = `
                        <div class="mb-3">
                            <label class="form-label">UPI ID</label>
                            <input type="text" class="form-control" required placeholder="username@upi">
                        </div>
                    `;
                    break;
                case 'card':
                    html = `
                        <div class="mb-3">
                            <label class="form-label">Card Number</label>
                            <input type="text" class="form-control" required placeholder="1234 5678 9012 3456">
                        </div>
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <label class="form-label">Expiry Date</label>
                                <input type="text" class="form-control" required placeholder="MM/YY">
                            </div>
                            <div class="col-md-6 mb-3">
                                <label class="form-label">CVV</label>
                                <input type="password" class="form-control" required placeholder="123">
                            </div>
                        </div>
                    `;
                    break;
                case 'netbanking':
                    html = `
                        <div class="mb-3">
                            <label class="form-label">Select Bank</label>
                            <select class="form-select" required>
                                <option value="">Choose your bank</option>
                                <option value="sbi">State Bank of India</option>
                                <option value="hdfc">HDFC Bank</option>
                                <option value="icici">ICICI Bank</option>
                                <option value="axis">Axis Bank</option>
                            </select>
                        </div>
                    `;
                    break;
                case 'cod':
                    html = `
                        <div class="alert alert-info">
                            Cash will be collected at the time of delivery.
                            Additional charges of ₹50 will be applied for COD.
                        </div>
                    `;
                    break;
            }
            
            detailsDiv.innerHTML = html;
        });
    }

    // Handle order quantity input changes
    const orderQuantityInput = document.getElementById('orderQuantity');
    if (orderQuantityInput) {
        orderQuantityInput.addEventListener('input', updateOrderSummary);
    }
});