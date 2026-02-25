// Sell Panel Functionality
let currentStep = 1;
let selectedCategory = '';

// Initialize sell panel
function initSellPanel() {
  // Load panel HTML
  fetch('/components/sell-panel.html')
    .then(response => response.text())
    .then(html => {
      document.body.insertAdjacentHTML('beforeend', html);
      setupEventListeners();
    });
}

// Set up event listeners
function setupEventListeners() {
  // Category selection
  document.querySelectorAll('.category-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCategory = btn.dataset.category;
      document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      nextStep();
    });
  });

  // Image upload preview
  const imageInput = document.getElementById('productImage');
  const imagePreview = document.getElementById('image-preview');
  const placeholder = document.getElementById('upload-placeholder');

  imageInput.addEventListener('change', function(e) {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = function(e) {
        imagePreview.src = e.target.result;
        imagePreview.classList.remove('hidden');
        placeholder.classList.add('hidden');
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  });

  // Form submission
  document.getElementById('sell-form').addEventListener('submit', handleSubmit);
}

// Show/hide sell panel
function toggleSellPanel() {
  const panel = document.getElementById('sell-panel');
  panel.classList.toggle('active');
}

function closeSellPanel() {
  const panel = document.getElementById('sell-panel');
  panel.classList.remove('active');
  resetForm();
}

// Step navigation
function nextStep() {
  if (currentStep < 4) {
    document.querySelector(`[data-step="${currentStep}"]`).classList.remove('active');
    currentStep++;
    document.querySelector(`[data-step="${currentStep}"]`).classList.add('active');
    updateStepDots();
  }
}

function previousStep() {
  if (currentStep > 1) {
    document.querySelector(`[data-step="${currentStep}"]`).classList.remove('active');
    currentStep--;
    document.querySelector(`[data-step="${currentStep}"]`).classList.add('active');
    updateStepDots();
  }
}

function updateStepDots() {
  document.querySelectorAll('.dot').forEach((dot, index) => {
    dot.classList.toggle('active', index + 1 === currentStep);
  });
}

// Handle form submission
async function handleSubmit(e) {
  e.preventDefault();

  const formData = new FormData(e.target);
  formData.append('category', selectedCategory);
  
  // Map form field names to API expected names
  if (formData.has('productName') && !formData.has('name')) {
    formData.append('name', formData.get('productName'));
  }
  
  // Add required dates that the API expects
  const today = new Date();
  const futureDate = new Date();
  futureDate.setDate(today.getDate() + 30); // 30 days from now
  
  formData.append('harvestDate', today.toISOString());
  formData.append('expiryDate', futureDate.toISOString());

  try {
    const response = await fetch('/api/products', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: formData
    });

    const result = await response.json();

    if (result.success) {
      // Show success message
      showNotification('Product listed successfully!', 'success');
      
      // Update farmer's inventory
      await updateInventory();
      
      // Close panel and reset form
      closeSellPanel();
    } else {
      showNotification(result.message || 'Failed to list product', 'error');
    }
  } catch (error) {
    console.error('Error listing product:', error);
    showNotification('An error occurred. Please try again.', 'error');
  }
}

async function updateInventory() {
  if (typeof loadInventory === 'function') {
    await loadInventory();
  }
}

// Reset form
function resetForm() {
  document.getElementById('sell-form').reset();
  currentStep = 1;
  selectedCategory = '';
  document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('selected'));
  document.querySelectorAll('.form-step').forEach(step => step.classList.remove('active'));
  document.querySelector('[data-step="1"]').classList.add('active');
  document.getElementById('image-preview').classList.add('hidden');
  document.getElementById('upload-placeholder').classList.remove('hidden');
  updateStepDots();
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// Initialize panel when document is ready
document.addEventListener('DOMContentLoaded', initSellPanel);