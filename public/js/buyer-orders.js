// Helper function to show error messages
function showError(message) {
    // Try to use the showError from buyer-dashboard.js if available
    if (typeof window.showError === 'function') {
        window.showError(message);
        return;
    }
    
    // Fallback: show alert
    console.error(message);
    alert(message);
}

async function loadOrders() {
    try {
        const response = await fetch('/api/buyer/orders', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to load orders');
        }
        
        const data = await response.json();
        orders = (data.data?.orders || data.orders || []).map(normalizeOrderForDisplay);
        displayOrders();
    } catch (error) {
        console.error('Error loading orders:', error);
        showError('Failed to load orders. Please try again.');
    }
}

function normalizeOrderForDisplay(order) {
    const pricing = order.pricingSnapshot || {};
    const escrow = order.paymentDetails?.escrow || {};

    return {
        ...order,
        pricingSummary: {
            subtotal: pricing.subtotal ?? order.subtotalAmount ?? 0,
            shipping: pricing.shipping ?? order.shippingAmount ?? order.shippingCost ?? 0,
            tax: pricing.tax ?? order.taxAmount ?? 0,
            total: pricing.total ?? order.totalAmount ?? 0,
            clientSubtotal: pricing.clientSubtotal,
            clientShipping: pricing.clientShipping,
            clientTax: pricing.clientTax,
            clientTotal: pricing.clientTotal,
            mismatchDetected: pricing.mismatchDetected,
            mismatchReason: pricing.mismatchReason
        },
        escrowSummary: {
            isEscrow: Boolean(escrow.isEscrow),
            status: escrow.releaseStatus || order.escrowStatus || 'not_applicable',
            releaseOtpSent: ['otp_sent', 'otp_verified', 'release_requested', 'released'].includes(escrow.releaseStatus),
            releaseTimeline: order.escrowTimeline || [],
            adminHoldAmount: escrow.adminHoldAmount || 0
        }
    };
}

function displayOrders() {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = orders.map(renderOrderRow).join('');
}

function renderOrderRow(order) {
    return `
        <tr>
            <td>
                <strong class="d-block">#${order.orderId || order._id}</strong>
                <small class="text-muted">${new Date(order.createdAt).toLocaleDateString()}</small>
            </td>
            <td>
                <div class="d-flex align-items-center">
                    <img src="${order.product?.images?.[0]?.url || '/img/default-product.jpg'}" 
                         class="rounded me-2" 
                         alt="${order.product?.name || order.productSnapshot?.name || 'Product'}"
                         style="width: 40px; height: 40px; object-fit: cover;">
                    <div>
                        <strong class="d-block">${order.product?.name || order.productSnapshot?.name || 'Product'}</strong>
                        <small class="text-muted">
                            ${order.quantity} ${(order.product?.unit || order.productSnapshot?.unit || 'unit')} × ₹${order.unitPrice?.toFixed?.(2) || order.product?.price || order.pricingSummary.subtotal / order.quantity}
                        </small>
                    </div>
                </div>
            </td>
            <td>
                <strong>₹${(order.pricingSummary.total).toFixed(2)}</strong>
                ${order.pricingSummary.mismatchDetected ? `<small class="d-block text-danger">Pricing discrepancy flagged</small>` : ''}
            </td>
            <td>
                ${renderStatusBadge(order)}
            </td>
            <td>
                <button class="btn btn-sm btn-outline-primary mb-1" onclick="viewOrderDetails('${order._id}')">
                    View Details
                </button>
                ${order.status === 'delivered' ? `
                    <button class="btn btn-sm btn-outline-success" onclick="rateProduct('${order._id}')">
                        Rate Product
                    </button>
                ` : ''}
            </td>
        </tr>
    `;
}

function getStatusColor(status) {
    const colors = {
        'pending': 'warning',
        'confirmed': 'info',
        'processing': 'primary',
        'shipped': 'info',
        'delivered': 'success',
        'cancelled': 'danger'
    };
    return colors[status] || 'secondary';
}

function getStatusText(status) {
    return status.charAt(0).toUpperCase() + status.slice(1);
}

function getStatusDescription(status) {
    const descriptions = {
        'pending': 'Awaiting confirmation',
        'confirmed': 'Order confirmed',
        'processing': 'Being prepared',
        'shipped': 'On the way',
        'delivered': 'Successfully delivered',
        'cancelled': 'Order cancelled'
    };
    return descriptions[status] || '';
}

function renderStatusBadge(order) {
    const status = order.status || 'pending';
    const color = getStatusColor(status);
    const text = getStatusText(status);
    const description = getStatusDescription(status);
    
    return `<span class="badge bg-${color}" title="${description}">${text}</span>`;
}

async function viewOrderDetails(orderId) {
    try {
        const response = await fetch(`/api/buyer/orders/${orderId}`, {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to load order details');
        }
        
        const data = await response.json();
        const order = data.data?.order || data.order;
        
        // Create and show a modal with order details
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.innerHTML = `
            <div class="modal-dialog modal-lg">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Order Details #${order._id}</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-md-6">
                                <h6>Product Information</h6>
                                <div class="card mb-3">
                                    <div class="card-body">
                                        <h6>${order.product.name}</h6>
                                        <p class="text-muted small">${order.product.description}</p>
                                        <div class="d-flex justify-content-between">
                                            <span>Quantity:</span>
                                            <span>${order.quantity} ${order.product.unit}</span>
                                        </div>
                                        <div class="d-flex justify-content-between">
                                            <span>Price per unit:</span>
                                            <span>₹${order.product.price}</span>
                                        </div>
                                        <div class="d-flex justify-content-between">
                                            <span>Total:</span>
                                            <span>₹${(order.quantity * order.product.price).toFixed(2)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-6">
                                <h6>Shipping Information</h6>
                                <div class="card mb-3">
                                    <div class="card-body">
                                        <p class="mb-1"><strong>${order.shippingAddress.name}</strong></p>
                                        <p class="mb-1">${order.shippingAddress.phone}</p>
                                        <p class="mb-1">${order.shippingAddress.addressLine1}</p>
                                        ${order.shippingAddress.addressLine2 ? `<p class="mb-1">${order.shippingAddress.addressLine2}</p>` : ''}
                                        <p class="mb-1">${order.shippingAddress.city}, ${order.shippingAddress.state}</p>
                                        <p class="mb-1">${order.shippingAddress.pincode}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="tracking-info">
                            <h6>Order Timeline</h6>
                            <div class="card">
                                <div class="card-body">
                                    ${generateOrderTimeline(order)}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        ${order.invoice ? `
                            <a href="${order.invoice}" class="btn btn-primary" target="_blank">
                                View Invoice
                            </a>
                        ` : ''}
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        const modalInstance = new bootstrap.Modal(modal);
        modalInstance.show();
        
        modal.addEventListener('hidden.bs.modal', () => {
            document.body.removeChild(modal);
        });
        
    } catch (error) {
        console.error('Error loading order details:', error);
        alert('Failed to load order details');
    }
}

function generateOrderTimeline(order) {
    const timeline = [
        { status: 'pending', date: order.createdAt, text: 'Order Placed' },
        { status: 'confirmed', date: order.confirmedAt, text: 'Order Confirmed' },
        { status: 'processing', date: order.processingAt, text: 'Processing Order' },
        { status: 'shipped', date: order.shippedAt, text: 'Order Shipped' },
        { status: 'delivered', date: order.deliveredAt, text: 'Order Delivered' }
    ].filter(item => item.date);

    return `
        <div class="timeline">
            ${timeline.map((item, index) => `
                <div class="timeline-item ${index < timeline.length - 1 ? 'mb-3' : ''}">
                    <div class="d-flex align-items-center">
                        <div class="timeline-icon bg-${getStatusColor(item.status)} text-white rounded-circle p-2 me-3">
                            <i class="bx bx-check"></i>
                        </div>
                        <div>
                            <strong>${item.text}</strong>
                            <br>
                            <small class="text-muted">
                                ${new Date(item.date).toLocaleString()}
                            </small>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

async function rateProduct(orderId) {
    // Create and show rating modal
    const modal = document.createElement('div');
    modal.className = 'modal fade';
    modal.innerHTML = `
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Rate Product</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                    <form id="ratingForm">
                        <div class="mb-3">
                            <label class="form-label">Rating</label>
                            <div class="rating-stars">
                                ${[1, 2, 3, 4, 5].map(star => `
                                    <i class="bx bx-star fs-4 me-1" 
                                       style="cursor: pointer;"
                                       onclick="setRating(${star})"></i>
                                `).join('')}
                            </div>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Review</label>
                            <textarea class="form-control" rows="3" placeholder="Write your review here..."></textarea>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-success" onclick="submitRating('${orderId}')">Submit Rating</button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    const modalInstance = new bootstrap.Modal(modal);
    modalInstance.show();
    
    modal.addEventListener('hidden.bs.modal', () => {
        document.body.removeChild(modal);
    });
}

let currentRating = 0;

function setRating(rating) {
    currentRating = rating;
    const stars = document.querySelectorAll('.rating-stars i');
    stars.forEach((star, index) => {
        star.classList.remove('bx-star', 'bxs-star');
        star.classList.add(index < rating ? 'bxs-star' : 'bx-star');
    });
}

async function submitRating(orderId) {
    const review = document.querySelector('#ratingForm textarea').value;
    
    if (currentRating === 0) {
        alert('Please select a rating');
        return;
    }
    
    try {
        const response = await fetch(`/api/buyer/orders/${orderId}/rate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({
                rating: currentRating,
                review: review
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.message || 'Failed to submit rating');
        }
        
        // Close modal and refresh orders
        const modal = document.querySelector('.modal');
        if (modal) {
            const modalInstance = bootstrap.Modal.getInstance(modal);
            if (modalInstance) {
                modalInstance.hide();
            }
            modal.remove();
        }
        
        await loadOrders();
        alert('Rating submitted successfully!');
        
    } catch (error) {
        console.error('Error submitting rating:', error);
        alert(error.message || 'Failed to submit rating');
    }
}

// Make functions globally available for onclick handlers
window.loadOrders = loadOrders;