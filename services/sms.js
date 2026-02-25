const twilio = require('twilio');
const winston = require('winston');

// Configure Twilio client (guard against missing/invalid credentials at startup)
let client = null;
const twilioEnabled = process.env.ENABLE_TWILIO === 'true';

// Only attempt Twilio initialization if explicitly enabled
if (twilioEnabled) {
  try {
    if (process.env.TWILIO_ACCOUNT_SID?.startsWith('AC') && process.env.TWILIO_AUTH_TOKEN) {
      client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      console.log('Twilio client initialized successfully');
    } else {
      console.warn('Twilio enabled but invalid credentials format. Expected TWILIO_ACCOUNT_SID to start with "AC".');
    }
  } catch (err) {
    console.warn('Failed to initialize Twilio client:', err.message);
  }
} else {
  console.log('Twilio SMS service is disabled. Set ENABLE_TWILIO=true to enable.');
}

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/sms-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/sms-combined.log' })
  ]
});

class SMSService {
  constructor() {
    this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
    this.templates = {
      otp: 'Your Agri Glow verification code is: {code}. Valid for 10 minutes.',
      order_confirmation: 'Order #{orderId} confirmed! Amount: ₹{amount}. Track your order in the app.',
      order_shipped: 'Great news! Your order #{orderId} has been shipped. Expected delivery: {deliveryDate}',
      order_delivered: 'Order #{orderId} delivered successfully. Thank you for choosing Agri Glow!',
      sale_notification: 'Congratulations! You sold {productName} for ₹{amount}. Payment credited to wallet.',
      low_stock: 'Alert: Your product "{productName}" has low stock ({quantity} left). Restock soon!',
      product_sold_out: 'Your product "{productName}" is now out of stock. Please restock to continue selling.',
      payment_received: 'Payment of ₹{amount} received for order #{orderId}. Check your wallet.',
      payment_failed: 'Payment failed for order #{orderId}. Please try again or contact support.',
      account_verified: 'Welcome to Agri Glow! Your account has been verified successfully.',
      password_reset: 'Your password reset code: {code}. Valid for 15 minutes.'
    };
  }

  // Format phone number to international format
  formatPhoneNumber(phone) {
    // Remove any non-digit characters
    let cleanPhone = phone.replace(/\D/g, '');
    
    // If it starts with 91 (India country code), keep it
    if (cleanPhone.startsWith('91') && cleanPhone.length === 12) {
      return '+' + cleanPhone;
    }
    
    // If it's a 10-digit Indian number, add country code
    if (cleanPhone.length === 10) {
      return '+91' + cleanPhone;
    }
    
    // If it starts with +91, return as is
    if (phone.startsWith('+91')) {
      return phone;
    }
    
    // Default: assume it needs +91 prefix
    return '+91' + cleanPhone;
  }

  // Replace template variables
  processTemplate(template, variables) {
    let message = this.templates[template] || template;
    
    // Replace variables in the format {variableName}
    Object.keys(variables).forEach(key => {
      const regex = new RegExp(`{${key}}`, 'g');
      message = message.replace(regex, variables[key]);
    });
    
    return message;
  }

  // Send SMS using Twilio
  async sendSMS(phoneNumber, message, options = {}) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      const messageData = {
        body: message,
        from: this.fromNumber,
        to: formattedPhone
      };
      
      // Add optional parameters
      if (options.statusCallback) {
        messageData.statusCallback = options.statusCallback;
      }
      
      if (!client) {
        throw new Error('Twilio client not configured');
      }
      const result = await client.messages.create(messageData);
      
      logger.info(`SMS sent successfully to ${formattedPhone}`, {
        messageId: result.sid,
        status: result.status,
        phone: formattedPhone
      });
      
      return {
        success: true,
        messageId: result.sid,
        status: result.status,
        phone: formattedPhone,
        provider: 'twilio'
      };
      
    } catch (error) {
      logger.error(`Failed to send SMS to ${phoneNumber}:`, {
        error: error.message,
        code: error.code,
        phone: phoneNumber
      });
      
      throw error;
    }
  }

  // Send templated SMS
  async sendTemplateSMS(templateName, phoneNumber, variables = {}, options = {}) {
    try {
      const message = this.processTemplate(templateName, variables);
      return await this.sendSMS(phoneNumber, message, options);
    } catch (error) {
      logger.error(`Failed to send template SMS "${templateName}" to ${phoneNumber}:`, error);
      throw error;
    }
  }

  // Send OTP SMS
  async sendOTP(phoneNumber, otp, purpose = 'verification') {
    const templates = {
      verification: 'Your Agri Glow verification code is: {code}. Valid for 10 minutes. Do not share with anyone.',
      password_reset: 'Your Agri Glow password reset code is: {code}. Valid for 15 minutes. Do not share with anyone.',
      login: 'Your Agri Glow login code is: {code}. Valid for 5 minutes. Do not share with anyone.'
    };
    
    const template = templates[purpose] || templates.verification;
    const message = template.replace('{code}', otp);
    
    return await this.sendSMS(phoneNumber, message, {
      purpose: purpose,
      category: 'otp'
    });
  }

  // Send order confirmation SMS
  async sendOrderConfirmation(phoneNumber, orderData) {
    const variables = {
      orderId: orderData.orderId,
      amount: orderData.totalAmount,
      productName: orderData.productName,
      quantity: orderData.quantity
    };
    
    return await this.sendTemplateSMS('order_confirmation', phoneNumber, variables, {
      category: 'order',
      orderId: orderData.orderId
    });
  }

  // Send sale notification SMS
  async sendSaleNotification(phoneNumber, saleData) {
    const variables = {
      productName: saleData.productName,
      amount: saleData.amount,
      quantity: saleData.quantity,
      buyerName: saleData.buyerName
    };
    
    return await this.sendTemplateSMS('sale_notification', phoneNumber, variables, {
      category: 'sale',
      orderId: saleData.orderId
    });
  }

  // Send product alert SMS
  async sendProductAlert(phoneNumber, alertData) {
    const templates = {
      low_stock: 'low_stock',
      sold_out: 'product_sold_out'
    };
    
    const template = templates[alertData.type] || 'low_stock';
    
    const variables = {
      productName: alertData.productName,
      quantity: alertData.quantity || 0
    };
    
    return await this.sendTemplateSMS(template, phoneNumber, variables, {
      category: 'product_alert',
      productId: alertData.productId
    });
  }

  // Send payment notification SMS
  async sendPaymentNotification(phoneNumber, paymentData) {
    const templates = {
      success: 'payment_received',
      failed: 'payment_failed'
    };
    
    const template = templates[paymentData.status] || 'payment_received';
    
    const variables = {
      amount: paymentData.amount,
      orderId: paymentData.orderId,
      transactionId: paymentData.transactionId
    };
    
    return await this.sendTemplateSMS(template, phoneNumber, variables, {
      category: 'payment',
      orderId: paymentData.orderId
    });
  }

  // Send delivery update SMS
  async sendDeliveryUpdate(phoneNumber, deliveryData) {
    const templates = {
      shipped: 'order_shipped',
      in_transit: 'Your order #{orderId} is on the way! Expected delivery: {deliveryDate}',
      delivered: 'order_delivered',
      delayed: 'Order #{orderId} delivery delayed. New expected date: {deliveryDate}. Sorry for inconvenience!'
    };
    
    const template = templates[deliveryData.status] || templates.shipped;
    
    const variables = {
      orderId: deliveryData.orderId,
      deliveryDate: deliveryData.deliveryDate,
      trackingId: deliveryData.trackingId
    };
    
    const message = this.processTemplate(template, variables);
    
    return await this.sendSMS(phoneNumber, message, {
      category: 'delivery',
      orderId: deliveryData.orderId
    });
  }

  // Handle SMS delivery status webhooks
  async handleStatusWebhook(webhookData) {
    try {
      const messageId = webhookData.MessageSid;
      const status = webhookData.MessageStatus;
      
      logger.info(`SMS status update: ${messageId} - ${status}`, webhookData);
      
      // You can update your database here with delivery status
      // For now, just log the status
      
      return {
        success: true,
        messageId: messageId,
        status: status
      };
      
    } catch (error) {
      logger.error('Error processing SMS status webhook:', error);
      throw error;
    }
  }

  // Validate phone number
  isValidPhoneNumber(phoneNumber) {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // Indian phone number validation
    if (cleanPhone.length === 10 && /^[6-9]\d{9}$/.test(cleanPhone)) {
      return true;
    }
    
    // International format validation
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      const mobileNumber = cleanPhone.substring(2);
      return /^[6-9]\d{9}$/.test(mobileNumber);
    }
    
    return false;
  }

  // Get SMS statistics (if you're tracking them)
  async getStats(timeframe = '24h') {
    // This would require you to implement SMS logging similar to email logs
    // For now, return basic stats
    return {
      sent: 0,
      delivered: 0,
      failed: 0,
      pending: 0
    };
  }

  // Bulk SMS sending (with rate limiting)
  async sendBulkSMS(recipients, message, options = {}) {
    const results = [];
    const batchSize = options.batchSize || 10;
    const delay = options.delay || 1000; // 1 second delay between batches
    
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      const batchPromises = batch.map(async (recipient) => {
        try {
          const result = await this.sendSMS(recipient.phone, message, {
            ...options,
            recipientId: recipient.id
          });
          return { success: true, phone: recipient.phone, result };
        } catch (error) {
          return { success: false, phone: recipient.phone, error: error.message };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Add delay between batches to avoid rate limiting
      if (i + batchSize < recipients.length) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return results;
  }
}

module.exports = new SMSService();