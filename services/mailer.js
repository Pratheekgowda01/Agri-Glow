const sgMail = require('@sendgrid/mail');
const nodemailer = require('nodemailer');
const mjml = require('mjml');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');
const EmailLog = require('../models/EmailLog');
const winston = require('winston');
const PDFDocument = require('pdfkit');

// Configure SMTP transport for Gmail
const smtpTransporter = nodemailer.createTransport({
  service: 'gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS.replace(/\s+/g, ''), // Remove any spaces from the app password
  },
  tls: {
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2'
  }
});

// Verify SMTP connection
smtpTransporter.verify((error, success) => {
  if (error) {
    console.error('SMTP connection error:', error);
  } else {
    console.log('SMTP server is ready to send emails');
  }
});

// Register common Handlebars helpers used in templates
try {
  handlebars.registerHelper('eq', (a, b) => a == b);
  // Add any other small helpers here if templates need them
  handlebars.registerHelper('uppercase', (str) => (String(str || '')).toUpperCase());
} catch (e) {
  console.warn('Failed to register Handlebars helpers:', e.message);
}

// Configure default email options
const defaultMailOptions = {
  from: {
    name: 'Agri Glow',
    address: process.env.SMTP_USER
  }
};

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/email-error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/email-combined.log' })
  ]
});

class MailerService {
  constructor() {
    this.templates = new Map();
    this.templatesReady = this.loadTemplates();
  }

  // Load and compile MJML templates
  async loadTemplates() {
    try {
      const templatesDir = path.join(__dirname, '../templates');
      const templateFiles = await fs.readdir(templatesDir);
      
      for (const file of templateFiles) {
        if (file.endsWith('.mjml')) {
          const templateName = path.basename(file, '.mjml');
          const templatePath = path.join(templatesDir, file);
          const mjmlContent = await fs.readFile(templatePath, 'utf8');
          
          // Compile MJML to HTML
          const { html } = mjml(mjmlContent);
          
          // Create Handlebars template
          const template = handlebars.compile(html);
          this.templates.set(templateName, template);
          
          logger.info(`Template loaded: ${templateName}`);
        }
      }
    } catch (error) {
      logger.error('Error loading email templates:', error);
    }
  }

  // Send email using SendGrid (primary)
  async sendWithSendGrid(emailData) {
    try {
      const msg = {
        to: emailData.to,
        from: emailData.from || process.env.SMTP_USER,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text || this.htmlToText(emailData.html),
        categories: [emailData.category || 'general'],
        custom_args: emailData.metadata || {}
      };

      const result = await sgMail.send(msg);
      
      return {
        success: true,
        provider: 'sendgrid',
        messageId: result[0].headers['x-message-id'],
        data: result[0]
      };
    } catch (error) {
      logger.error('SendGrid error:', error);
      throw error;
    }
  }

  // Send email using SMTP (fallback)
  async sendWithSMTP(emailData) {
    try {
      const mailOptions = {
        from: emailData.from || process.env.SMTP_USER,
        to: emailData.to,
        subject: emailData.subject,
        html: emailData.html,
        text: emailData.text || this.htmlToText(emailData.html)
      };

      const result = await smtpTransporter.sendMail(mailOptions);
      
      return {
        success: true,
        provider: 'smtp',
        messageId: result.messageId,
        data: result
      };
    } catch (error) {
      logger.error('SMTP error:', error);
      throw error;
    }
  }

  // Main send method with fallback logic
  async sendEmail(templateName, recipientEmail, variables = {}, options = {}) {
    let emailLog = null;
    
    try {
      if (this.templatesReady) {
        try {
          await this.templatesReady;
        } catch (loadError) {
          logger.error('Template loading failed:', loadError);
        }
      }

      if (!this.templates.size) {
        try {
          await this.loadTemplates();
        } catch (reloadError) {
          logger.error('Template reload failed:', reloadError);
        }
      }

      const template = this.templates.get(templateName);
      if (!template) {
        throw new Error(`Template '${templateName}' not found`);
      }

      // Compile template with variables
      const compiledHtml = template({
        ...variables,
        baseUrl: process.env.BASE_URL || 'http://localhost:3000',
        year: new Date().getFullYear(),
        companyName: 'Agri Glow'
      });

      // Determine logo URL preference. Prefer a PNG/PNG-like file placed in public/images by the developer.
      const fsSync = require('fs');
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const imagesDir = 'public/images';
      const candidates = [
        'agriglowlogo-removebg-preview.png',
        'agriglow-logo.png',
        'agriglow-logo.jpg',
        'agriglow-logo.jpeg',
        'agriglow-logo.svg'
      ];

      let chosen = null;
      for (const name of candidates) {
        try {
          if (fsSync.existsSync(`${imagesDir}/${name}`)) {
            chosen = name;
            break;
          }
        } catch (e) {
          // ignore
        }
      }

      // Default to svg fallback if nothing found
      const defaultSvg = 'agriglow-logo.svg';
      if (!chosen) chosen = defaultSvg;

      const logoUrl = `${baseUrl}/images/${chosen}`;

      // Final HTML sent in the email (no prepended logo, template controls logo)
      const html = compiledHtml;

      const emailData = {
        to: recipientEmail,
        from: options.from || process.env.SMTP_USER,
        subject: options.subject || this.generateSubject(templateName, variables),
        html: html,
        category: options.category || 'notification',  // Default to notification if no category specified
        metadata: options.metadata || {},
        priority: options.priority || 'normal'
      };

      // Create email log entry
      emailLog = new EmailLog({
        to: emailData.to,
        from: emailData.from,
        subject: emailData.subject,
        template: {
          name: templateName,
          variables: variables
        },
        htmlContent: html,
        textContent: this.htmlToText(html),
        category: emailData.category,
        priority: emailData.priority,
        provider: (process.env.SMTP_USER && process.env.SMTP_PASS) ? 'smtp' : 'sendgrid', // prefer SMTP when available
        metadata: options.metadata || {}
      });

      await emailLog.save();

      let result;
      
      try {
        // Always try SMTP first since we have it configured
        result = await this.sendWithSMTP(emailData);
        emailLog.provider = 'smtp';
        await emailLog.markAsSent(result.data);
        logger.info(`Email sent successfully via SMTP to ${recipientEmail}`);
      } catch (smtpError) {
        logger.warn('SMTP failed, trying SendGrid fallback:', smtpError.message);
        
        // Only try SendGrid if we have a valid API key
        if (process.env.SENDGRID_API_KEY?.startsWith('SG.')) {
          try {
            result = await this.sendWithSendGrid(emailData);
            emailLog.provider = 'sendgrid';
            await emailLog.markAsSent(result.data);
            logger.info(`Email sent successfully via SendGrid to ${recipientEmail}`);
          } catch (sendGridError) {
            logger.error('Both SMTP and SendGrid failed:', sendGridError.message);
            await emailLog.markAsFailed(sendGridError);
            throw new Error('All email delivery methods failed');
          }
        } else {
          logger.error('SMTP failed and SendGrid not configured:', smtpError.message);
          await emailLog.markAsFailed(smtpError);
          throw smtpError;
        }
      }

      return {
        success: true,
        emailLogId: emailLog._id,
        provider: result.provider,
        messageId: result.messageId
      };

    } catch (error) {
      if (emailLog) {
        await emailLog.markAsFailed(error);
      }
      
      logger.error(`Failed to send email to ${recipientEmail}:`, error);
      throw error;
    }
  }

  // Generate subject line based on template
  generateSubject(templateName, variables) {
    const subjects = {
      login_alert: 'Agri Glow Login Alert',
      order_confirmation: `Order Confirmation #${variables.orderId || 'N/A'}`,
      sale_notification: `New Sale! Order #${variables.orderId || 'N/A'}`,
      payout_notification: `Payment of ₹${variables.amount || '0'} received`,
      product_stop: `Your product "${variables.productName || 'N/A'}" is out of stock`,
      password_reset: 'Reset your Agri Glow password',
      welcome: 'Welcome to Agri Glow!'
    };

    return subjects[templateName] || 'Agri Glow Notification';
  }

  // Convert HTML to plain text (basic implementation)
  htmlToText(html) {
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/\s+/g, ' ')    // Normalize whitespace
      .trim();
  }

  // Handle webhook events (for delivery tracking)
  async handleWebhook(provider, eventData) {
    try {
      let messageId, event, timestamp;
      
      if (provider === 'sendgrid') {
        messageId = eventData.sg_message_id;
        event = eventData.event;
        timestamp = new Date(eventData.timestamp * 1000);
      }
      
      // Find email log by message ID
      const emailLog = await EmailLog.findOne({
        'providerData.messageId': messageId
      });
      
      if (!emailLog) {
        logger.warn(`Email log not found for message ID: ${messageId}`);
        return;
      }
      
      // Update email log based on event
      switch (event) {
        case 'delivered':
          emailLog.status = 'delivered';
          emailLog.deliveredAt = timestamp;
          break;
        case 'open':
          emailLog.status = 'opened';
          emailLog.openedAt = timestamp;
          break;
        case 'click':
          emailLog.status = 'clicked';
          emailLog.clickedAt = timestamp;
          break;
        case 'bounce':
          emailLog.status = 'bounced';
          emailLog.bouncedAt = timestamp;
          break;
        case 'spam':
          emailLog.status = 'spam';
          break;
        case 'unsubscribe':
          emailLog.status = 'unsubscribed';
          break;
      }
      
      // Add event to history
      emailLog.events.push({
        event: event,
        timestamp: timestamp,
        data: eventData
      });
      
      await emailLog.save();
      
      logger.info(`Email webhook processed: ${event} for ${messageId}`);
      
    } catch (error) {
      logger.error('Error processing email webhook:', error);
    }
  }

  // Get email statistics
  async getStats(timeframe = '24h') {
    return await EmailLog.getStats(timeframe);
  }

  // Generate PDF invoice
  async generatePDFInvoice(order) {
    const doc = new PDFDocument();
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));
    
    // Add content to PDF
    doc.fontSize(20).text('AgriGlow', { align: 'center' });
    doc.moveDown();
    doc.fontSize(16).text('Order Invoice', { align: 'center' });
    doc.moveDown();

    // Invoice details
    doc.fontSize(12);
    doc.text(`Invoice #: ${order._id}`);
    doc.text(`Order Date: ${order.createdAt.toLocaleDateString()}`);
    doc.text(`Payment Status: ${order.paymentStatus}`);
    doc.moveDown();

    // Buyer & Seller details
    doc.text('Buyer Details:');
    doc.text(order.buyer.name);
    doc.text(order.buyer.address);
    doc.text(order.buyer.phone);
    doc.text(order.buyer.email);
    doc.moveDown();

    doc.text('Farmer Details:');
    doc.text(order.farmer.name);
    doc.text(order.farmer.address);
    doc.text(order.farmer.phone);
    doc.text(order.farmer.email);
    doc.moveDown();

    // Order items table
    const tableTop = doc.y;
    const itemX = 50;
    const qtyX = 250;
    const priceX = 350;
    const totalX = 450;

    doc.text('Item', itemX, tableTop);
    doc.text('Quantity', qtyX, tableTop);
    doc.text('Price', priceX, tableTop);
    doc.text('Total', totalX, tableTop);
    doc.moveDown();

    let y = doc.y;
    order.products.forEach(item => {
      doc.text(item.product.name, itemX, y);
      doc.text(item.quantity.toString(), qtyX, y);
      doc.text(`₹${item.price}`, priceX, y);
      doc.text(`₹${item.quantity * item.price}`, totalX, y);
      y += 20;
    });

    doc.moveDown();
    doc.text(`Subtotal: ₹${order.subtotal}`, totalX);
    doc.text(`Tax: ₹${order.tax}`, totalX);
    doc.text(`Total: ₹${order.total}`, totalX);

    // Payment info
    doc.moveDown();
    doc.text('Payment Information:');
    doc.text(`Method: ${order.paymentMethod}`);
    doc.text(`Transaction ID: ${order.transactionId}`);
    doc.text(`Payment Date: ${order.paymentDate.toLocaleDateString()}`);

    // Terms
    doc.moveDown();
    doc.fontSize(10);
    doc.text('Terms & Conditions:');
    doc.text('1. All prices are inclusive of GST');
    doc.text('2. This is a computer generated invoice');
    doc.text('3. For any queries, please contact support@agriglow.com');

    doc.end();

    return Buffer.concat(buffers);
  }

  // Send invoice email
  async sendInvoiceEmail(order) {
    try {
      const template = this.templates.get('invoice');
      const variables = {
        ...order,
        currentYear: new Date().getFullYear()
      };

      const html = template(variables);

      // Generate PDF invoice
      const pdfBuffer = await this.generatePDFInvoice(order);

      const emailData = {
        to: order.buyer.email,
        subject: `Order Invoice - ${order._id}`,
        html,
        category: 'invoice',
        metadata: {
          orderId: order._id
        },
        attachments: [{
          filename: `invoice-${order._id}.pdf`,
          content: pdfBuffer
        }]
      };

      return await this.sendEmail('invoice', order.buyer.email, variables, emailData);
    } catch (error) {
      logger.error('Invoice email error:', error);
      throw error;
    }
  }

  // Retry failed emails
  async retryFailedEmails() {
    const now = new Date();
    const failedEmails = await EmailLog.find({
      status: { $in: ['queued', 'failed'] },
      'attempts.count': { $lt: 3 },
      'attempts.nextRetry': { $lte: now }
    }).limit(50);
    
    const results = [];
    
    for (const emailLog of failedEmails) {
      try {
        await emailLog.incrementAttempt();
        
        const result = await this.sendEmail(
          emailLog.template.name,
          emailLog.to,
          emailLog.template.variables,
          {
            subject: emailLog.subject,
            category: emailLog.category,
            metadata: emailLog.metadata
          }
        );
        
        results.push({ success: true, emailId: emailLog._id });
        
      } catch (error) {
        await emailLog.markAsFailed(error);
        results.push({ success: false, emailId: emailLog._id, error: error.message });
      }
    }
    
    return results;
  }
}

module.exports = new MailerService();