// =====================================================
// EMAIL SERVICE
// =====================================================
// Sends transactional emails:
// - Email verification for new signups
// - Password reset emails
// - Trial expiration warnings
// =====================================================

const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Email configuration from environment variables
const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
};

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@revenueradar.com';
const FROM_NAME = process.env.FROM_NAME || 'Revenue Radar';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

class EmailService {
  constructor() {
    this.transporter = null;
    this.isConfigured = !!(EMAIL_CONFIG.auth.user && EMAIL_CONFIG.auth.pass);

    if (this.isConfigured) {
      this.transporter = nodemailer.createTransporter(EMAIL_CONFIG);
      console.log('✅ Email service configured');
    } else {
      console.log('⚠️  Email service not configured - emails will be logged to console');
    }
  }

  /**
   * Generate a secure random token
   * @param {number} length - Token length in bytes
   * @returns {string} Hex token
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Send email verification email
   * @param {string} email - User email
   * @param {string} name - User name
   * @param {string} token - Verification token
   */
  async sendVerificationEmail(email, name, token) {
    const verificationUrl = `${APP_URL}/auth/verify-email?token=${token}`;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 40px 30px; text-align: center; }
          .logo { font-size: 48px; margin-bottom: 10px; }
          .header-text { color: #fbbf24; font-size: 28px; font-weight: 800; margin: 0; }
          .content { padding: 40px 30px; }
          .greeting { font-size: 20px; color: #333; margin-bottom: 20px; }
          .message { font-size: 16px; color: #666; line-height: 1.6; margin-bottom: 30px; }
          .button { display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color: #1a1a1a; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; }
          .button:hover { opacity: 0.9; }
          .footer { padding: 30px; text-align: center; color: #999; font-size: 14px; background: #f9f9f9; }
          .url-fallback { margin-top: 20px; padding: 15px; background: #f5f5f5; border-radius: 6px; font-size: 12px; color: #666; word-break: break-all; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">$</div>
            <h1 class="header-text">Revenue Radar</h1>
          </div>
          <div class="content">
            <p class="greeting">Hi ${name},</p>
            <p class="message">
              Welcome to Revenue Radar! We're excited to have you on board.
            </p>
            <p class="message">
              To get started with your <strong>FREE 30-day trial</strong> (up to 20 invoices), please verify your email address by clicking the button below:
            </p>
            <center>
              <a href="${verificationUrl}" class="button">Verify Email & Start Trial</a>
            </center>
            <p class="url-fallback">
              Or copy and paste this link in your browser:<br>
              ${verificationUrl}
            </p>
            <p class="message" style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
              <strong>Your Trial Includes:</strong><br>
              ✅ 30 days of full access<br>
              ✅ Process up to 20 invoices<br>
              ✅ AI-powered savings detection<br>
              ✅ Automated opportunity alerts<br>
              ✅ Email invoice monitoring<br>
              ✅ VP Dashboard access
            </p>
          </div>
          <div class="footer">
            This link expires in 24 hours for security.<br>
            If you didn't sign up for Revenue Radar, please ignore this email.
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
Hi ${name},

Welcome to Revenue Radar!

To start your FREE 30-day trial (up to 20 invoices), verify your email by visiting:
${verificationUrl}

Your Trial Includes:
- 30 days of full access
- Process up to 20 invoices
- AI-powered savings detection
- Automated opportunity alerts
- Email invoice monitoring
- VP Dashboard access

This link expires in 24 hours.

If you didn't sign up for Revenue Radar, please ignore this email.

- Revenue Radar Team
    `;

    return this.sendEmail({
      to: email,
      subject: 'Verify Your Email - Start Your Free Trial',
      html,
      text
    });
  }

  /**
   * Send trial expiration warning
   * @param {string} email - User email
   * @param {string} name - User name
   * @param {number} daysLeft - Days remaining in trial
   * @param {number} invoicesLeft - Invoices remaining in trial
   */
  async sendTrialExpirationWarning(email, name, daysLeft, invoicesLeft) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); padding: 40px 30px; text-align: center; }
          .logo { font-size: 48px; margin-bottom: 10px; }
          .header-text { color: #1a1a1a; font-size: 28px; font-weight: 800; margin: 0; }
          .content { padding: 40px 30px; }
          .warning-box { background: #fff3cd; border-left: 4px solid #f59e0b; padding: 20px; margin: 20px 0; border-radius: 6px; }
          .stats { display: flex; justify-content: space-around; margin: 30px 0; }
          .stat { text-align: center; }
          .stat-number { font-size: 48px; font-weight: 800; color: #f59e0b; }
          .stat-label { color: #666; font-size: 14px; margin-top: 5px; }
          .button { display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); color: #fbbf24; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; }
          .footer { padding: 30px; text-align: center; color: #999; font-size: 14px; background: #f9f9f9; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">$</div>
            <h1 class="header-text">Trial Ending Soon</h1>
          </div>
          <div class="content">
            <p style="font-size: 18px; color: #333;">Hi ${name},</p>
            <div class="warning-box">
              <strong style="color: #f59e0b;">⚠️ Your Revenue Radar trial is ending soon!</strong>
            </div>
            <div class="stats">
              <div class="stat">
                <div class="stat-number">${daysLeft}</div>
                <div class="stat-label">Days Left</div>
              </div>
              <div class="stat">
                <div class="stat-number">${invoicesLeft}</div>
                <div class="stat-label">Invoices Left</div>
              </div>
            </div>
            <p style="font-size: 16px; color: #666; line-height: 1.6;">
              To continue using Revenue Radar and unlock unlimited invoice processing,
              contact us to upgrade to a paid plan.
            </p>
            <center style="margin-top: 30px;">
              <a href="${APP_URL}/dashboard/vp-view.html" class="button">Go to Dashboard</a>
            </center>
          </div>
          <div class="footer">
            Questions? Reply to this email or contact support.
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
Hi ${name},

Your Revenue Radar trial is ending soon!

Days Left: ${daysLeft}
Invoices Left: ${invoicesLeft}

To continue using Revenue Radar with unlimited invoice processing, contact us to upgrade.

Visit your dashboard: ${APP_URL}/dashboard/vp-view.html

- Revenue Radar Team
    `;

    return this.sendEmail({
      to: email,
      subject: `Trial Ending: ${daysLeft} Days & ${invoicesLeft} Invoices Left`,
      html,
      text
    });
  }

  /**
   * Send generic email
   * @param {Object} options - Email options
   */
  async sendEmail(options) {
    const mailOptions = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html
    };

    if (!this.isConfigured) {
      // Log to console in development
      console.log('\n=== EMAIL (Not Sent - No SMTP Config) ===');
      console.log('To:', options.to);
      console.log('Subject:', options.subject);
      console.log('Text:\n', options.text);
      console.log('=== END EMAIL ===\n');

      // Return success but indicate it wasn't actually sent
      return {
        success: true,
        messageId: 'dev-mode-' + Date.now(),
        note: 'Email logged to console - SMTP not configured'
      };
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log(`✅ Email sent to ${options.to}: ${info.messageId}`);
      return {
        success: true,
        messageId: info.messageId
      };
    } catch (error) {
      console.error('❌ Email send error:', error);
      throw error;
    }
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection() {
    if (!this.isConfigured) {
      return { success: false, error: 'SMTP not configured' };
    }

    try {
      await this.transporter.verify();
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
module.exports = new EmailService();
