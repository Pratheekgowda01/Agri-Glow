require('dotenv').config();
const nodemailer = require('nodemailer');

async function testEmail() {
    // Create the SMTP transport
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    try {
        // Send test email
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: process.env.SMTP_USER,
            subject: 'SMTP Test',
            text: 'This is a test email from the SMTP configuration',
            html: '<h1>SMTP Test</h1><p>This is a test email from the SMTP configuration</p>'
        });

        console.log('Message sent successfully:', info);
        process.exit(0);
    } catch (error) {
        console.error('Error sending email:', error);
        process.exit(1);
    }
}

testEmail();