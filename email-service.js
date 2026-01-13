// =====================================================
// EMAIL SERVICE
// =====================================================
// Sends transactional emails:
// - Email verification for new signups
// - Password reset emails
// - Trial expiration warnings
// - Access request notifications
//
// Supports two providers:
// 1. Resend (recommended) - Modern API, excellent deliverability
// 2. SMTP/Gmail (fallback) - Traditional email sending
// =====================================================

const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Try to load Resend (optional dependency)
let Resend;
try {
  Resend = require('resend').Resend;
} catch (e) {
  Resend = null;
}

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

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.EMAIL_FROM || process.env.FROM_EMAIL || 'onboarding@resend.dev';
const FROM_NAME = process.env.EMAIL_FROM_NAME || process.env.FROM_NAME || 'Revenue Radar';
const APP_URL = process.env.APP_URL || 'http://localhost:5050';

class EmailService {
  constructor() {
    this.transporter = null;
    this.resend = null;
    this.provider = 'none';

    // Priority 1: Resend (modern, recommended)
    if (RESEND_API_KEY && Resend) {
      this.resend = new Resend(RESEND_API_KEY);
      this.provider = 'resend';
      this.isConfigured = true;
      console.log('✅ Email service configured (Resend)');
    }
    // Priority 2: SMTP/Gmail (fallback)
    else if (EMAIL_CONFIG.auth.user && EMAIL_CONFIG.auth.pass) {
      this.transporter = nodemailer.createTransport(EMAIL_CONFIG);
      this.provider = 'smtp';
      this.isConfigured = true;
      console.log('✅ Email service configured (SMTP)');
    }
    // No email provider configured
    else {
      this.isConfigured = false;
      console.log('⚠️  Email service not configured - emails will be logged to console');
      console.log('   Set RESEND_API_KEY for Resend, or SMTP_USER/SMTP_PASS for Gmail');
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
    if (!this.isConfigured) {
      // Log to console in development
      console.log('\n=== EMAIL (Not Sent - No Provider Config) ===');
      console.log('To:', options.to);
      console.log('Subject:', options.subject);
      console.log('Text:\n', options.text?.substring(0, 500) + '...');
      console.log('=== END EMAIL ===\n');

      // Return success but indicate it wasn't actually sent
      return {
        success: true,
        messageId: 'dev-mode-' + Date.now(),
        note: 'Email logged to console - no provider configured'
      };
    }

    try {
      // Use Resend if available
      if (this.provider === 'resend' && this.resend) {
        const { data, error } = await this.resend.emails.send({
          from: `${FROM_NAME} <${FROM_EMAIL}>`,
          to: [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text
        });

        if (error) {
          console.error('❌ Resend error:', error);
          throw new Error(error.message || 'Resend email failed');
        }

        console.log(`✅ Email sent via Resend to ${options.to}: ${data.id}`);
        return {
          success: true,
          messageId: data.id,
          provider: 'resend'
        };
      }

      // Fallback to SMTP/nodemailer
      if (this.provider === 'smtp' && this.transporter) {
        const mailOptions = {
          from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
          to: options.to,
          subject: options.subject,
          text: options.text,
          html: options.html
        };

        const info = await this.transporter.sendMail(mailOptions);
        console.log(`✅ Email sent via SMTP to ${options.to}: ${info.messageId}`);
        return {
          success: true,
          messageId: info.messageId,
          provider: 'smtp'
        };
      }

      throw new Error('No email provider available');

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

  // =====================================================
  // ACCESS REQUEST EMAIL TEMPLATES
  // =====================================================

  /**
   * Send notification to admin about new access request
   * @param {Object} request - Request details
   */
  async sendAccessRequestNotification(request) {
    const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || 'admin@revenueradar.com';
    const approveUrl = `${APP_URL}/signup/approve/${request.approvalToken}`;
    const denyUrl = `${APP_URL}/signup/deny/${request.denialToken}`;
    const dashboardUrl = `${APP_URL}/dashboard/admin-ops.html`;

    // Calculate request quality score
    let qualityScore = 0;
    let qualityBadges = [];

    if (request.linkedinUrl) {
      qualityScore += 1;
      qualityBadges.push('🔗 LinkedIn');
    }
    if (request.reason && request.reason.length > 30) {
      qualityScore += 1;
      qualityBadges.push('📝 Detailed reason');
    }
    if (!request.email.includes('gmail.com') && !request.email.includes('yahoo.com') && !request.email.includes('hotmail.com')) {
      qualityScore += 1;
      qualityBadges.push('🏢 Company email');
    }

    const qualityLabel = qualityScore >= 2 ? '⭐ High Quality' : qualityScore >= 1 ? '👍 Good' : '📋 Basic';

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); padding: 30px; text-align: center; }
          .logo { font-size: 36px; margin-bottom: 5px; }
          .header-text { color: #fbbf24; font-size: 24px; font-weight: 800; margin: 0; }
          .header-sub { color: #999; font-size: 14px; margin-top: 5px; }
          .content { padding: 30px; }
          .quality-badge { display: inline-block; padding: 6px 12px; background: ${qualityScore >= 2 ? '#d1fae5' : qualityScore >= 1 ? '#fef3c7' : '#f3f4f6'}; color: ${qualityScore >= 2 ? '#065f46' : qualityScore >= 1 ? '#92400e' : '#374151'}; border-radius: 20px; font-size: 14px; font-weight: 600; margin-bottom: 20px; }
          .info-box { background: #f9fafb; border-radius: 10px; padding: 20px; margin: 20px 0; }
          .info-row { margin: 12px 0; display: flex; }
          .info-label { color: #6b7280; font-size: 14px; width: 120px; flex-shrink: 0; }
          .info-value { color: #1f2937; font-size: 14px; font-weight: 500; }
          .reason-box { background: #fffbeb; border-left: 4px solid #fbbf24; padding: 15px; margin: 20px 0; border-radius: 0 8px 8px 0; }
          .reason-label { color: #92400e; font-weight: 600; font-size: 13px; margin-bottom: 8px; }
          .reason-text { color: #78350f; font-size: 14px; line-height: 1.5; }
          .button-row { display: flex; gap: 15px; justify-content: center; margin: 30px 0; }
          .button { display: inline-block; padding: 14px 32px; border-radius: 8px; font-weight: 700; font-size: 15px; text-decoration: none; text-align: center; }
          .button-approve { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; }
          .button-deny { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; }
          .button-view { background: #e5e7eb; color: #374151; }
          .footer { padding: 20px 30px; text-align: center; color: #9ca3af; font-size: 13px; background: #f9fafb; }
          .badges { margin-top: 10px; }
          .badge { display: inline-block; padding: 4px 8px; background: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: 12px; margin: 2px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">$</div>
            <h1 class="header-text">New Access Request</h1>
            <p class="header-sub">Someone wants to join Revenue Radar</p>
          </div>
          <div class="content">
            <div class="quality-badge">${qualityLabel}</div>

            <div class="info-box">
              <div class="info-row">
                <span class="info-label">Name:</span>
                <span class="info-value">${request.name}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Email:</span>
                <span class="info-value">${request.email}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Company:</span>
                <span class="info-value">${request.companyName}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Requested Role:</span>
                <span class="info-value" style="text-transform: capitalize;">${request.requestedRole}</span>
              </div>
              ${request.linkedinUrl ? `
              <div class="info-row">
                <span class="info-label">LinkedIn:</span>
                <span class="info-value"><a href="${request.linkedinUrl}" style="color: #3b82f6;">${request.linkedinUrl}</a></span>
              </div>
              ` : ''}
              ${qualityBadges.length > 0 ? `
              <div class="badges">
                ${qualityBadges.map(b => `<span class="badge">${b}</span>`).join('')}
              </div>
              ` : ''}
            </div>

            ${request.reason && request.reason !== 'Not provided' ? `
            <div class="reason-box">
              <div class="reason-label">WHY THEY NEED ACCESS:</div>
              <div class="reason-text">${request.reason}</div>
            </div>
            ` : ''}

            <div class="button-row">
              <a href="${approveUrl}" class="button button-approve">✓ Approve</a>
              <a href="${denyUrl}" class="button button-deny">✗ Deny</a>
            </div>

            <center>
              <a href="${dashboardUrl}" class="button button-view">View in Dashboard</a>
            </center>
          </div>
          <div class="footer">
            This link expires in 7 days. After that, use the admin dashboard to review.<br>
            Requested at: ${new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
NEW ACCESS REQUEST - Revenue Radar

${qualityLabel}

Name: ${request.name}
Email: ${request.email}
Company: ${request.companyName}
Requested Role: ${request.requestedRole}
${request.linkedinUrl ? `LinkedIn: ${request.linkedinUrl}` : ''}

${request.reason && request.reason !== 'Not provided' ? `Why they need access:\n${request.reason}` : ''}

APPROVE: ${approveUrl}
DENY: ${denyUrl}
VIEW IN DASHBOARD: ${dashboardUrl}

This link expires in 7 days.
Requested at: ${new Date(request.createdAt).toLocaleString()}
    `;

    return this.sendEmail({
      to: adminEmail,
      subject: `🔔 New Access Request: ${request.name} from ${request.companyName}`,
      html,
      text
    });
  }

  /**
   * Send confirmation to user that their request was received
   * @param {string} email - User email
   * @param {string} name - User name
   */
  async sendAccessRequestConfirmation(email, name) {
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
          .check-icon { font-size: 64px; text-align: center; margin-bottom: 20px; }
          .message { font-size: 16px; color: #666; line-height: 1.6; margin: 20px 0; }
          .highlight { background: #d1fae5; border-radius: 8px; padding: 20px; margin: 25px 0; text-align: center; }
          .highlight-text { color: #065f46; font-weight: 600; font-size: 16px; }
          .footer { padding: 30px; text-align: center; color: #999; font-size: 14px; background: #f9f9f9; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">$</div>
            <h1 class="header-text">Revenue Radar</h1>
          </div>
          <div class="content">
            <div class="check-icon">📬</div>
            <p class="message" style="font-size: 20px; color: #333;">Hi ${name},</p>
            <p class="message">
              Thank you for your interest in Revenue Radar! We've received your access request.
            </p>
            <div class="highlight">
              <p class="highlight-text">Your request is being reviewed.<br>We'll email you when it's been processed.</p>
            </div>
            <p class="message">
              This usually takes less than 24 hours. If you have any questions in the meantime,
              feel free to reply to this email.
            </p>
          </div>
          <div class="footer">
            Revenue Radar - Sales Intelligence Platform
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
Hi ${name},

Thank you for your interest in Revenue Radar! We've received your access request.

Your request is being reviewed. We'll email you when it's been processed.

This usually takes less than 24 hours. If you have any questions, feel free to reply to this email.

- Revenue Radar Team
    `;

    return this.sendEmail({
      to: email,
      subject: '📬 Access Request Received - Revenue Radar',
      html,
      text
    });
  }

  /**
   * Send welcome email when access is approved
   * @param {Object} options - { email, name, role, temporaryPassword }
   */
  async sendAccessApprovedEmail({ email, name, role, temporaryPassword }) {
    const loginUrl = `${APP_URL}/dashboard/login.html`;

    const roleDescriptions = {
      rep: 'Sales Rep - Access to your leads, opportunities, and performance tracking',
      manager: 'Manager - Team oversight, analytics, and lead management',
      viewer: 'Viewer - Read-only access to dashboards and reports',
      admin: 'Administrator - Full access to all features and settings'
    };

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
          .container { max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
          .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 40px 30px; text-align: center; }
          .logo { font-size: 48px; margin-bottom: 10px; }
          .header-text { color: white; font-size: 28px; font-weight: 800; margin: 0; }
          .content { padding: 40px 30px; }
          .welcome-icon { font-size: 64px; text-align: center; margin-bottom: 20px; }
          .message { font-size: 16px; color: #666; line-height: 1.6; margin: 20px 0; }
          .credentials-box { background: #1a1a1a; border-radius: 10px; padding: 25px; margin: 25px 0; }
          .cred-row { margin: 15px 0; }
          .cred-label { color: #9ca3af; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; }
          .cred-value { color: #fbbf24; font-size: 18px; font-weight: 600; font-family: monospace; }
          .role-badge { display: inline-block; padding: 8px 16px; background: #dbeafe; color: #1e40af; border-radius: 20px; font-size: 14px; font-weight: 600; text-transform: capitalize; }
          .role-desc { color: #6b7280; font-size: 14px; margin-top: 10px; }
          .button { display: inline-block; padding: 16px 40px; background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%); color: #1a1a1a; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; }
          .warning { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 25px 0; border-radius: 0 8px 8px 0; font-size: 14px; color: #92400e; }
          .footer { padding: 30px; text-align: center; color: #999; font-size: 14px; background: #f9f9f9; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">$</div>
            <h1 class="header-text">Access Approved!</h1>
          </div>
          <div class="content">
            <div class="welcome-icon">🎉</div>
            <p class="message" style="font-size: 20px; color: #333;">Welcome to Revenue Radar, ${name}!</p>
            <p class="message">
              Great news - your access request has been approved! You can now log in to the dashboard.
            </p>

            <p style="margin: 20px 0;">
              <span class="role-badge">${role}</span>
              <p class="role-desc">${roleDescriptions[role] || 'Dashboard access'}</p>
            </p>

            <div class="credentials-box">
              <div class="cred-row">
                <div class="cred-label">Email</div>
                <div class="cred-value">${email}</div>
              </div>
              <div class="cred-row">
                <div class="cred-label">Temporary Password</div>
                <div class="cred-value">${temporaryPassword}</div>
              </div>
            </div>

            <div class="warning">
              <strong>⚠️ Important:</strong> Please change your password after your first login for security.
            </div>

            <center style="margin-top: 30px;">
              <a href="${loginUrl}" class="button">Log In Now</a>
            </center>
          </div>
          <div class="footer">
            Questions? Reply to this email for support.<br>
            Revenue Radar - Sales Intelligence Platform
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
Welcome to Revenue Radar, ${name}!

Great news - your access request has been approved!

YOUR LOGIN CREDENTIALS:
Email: ${email}
Temporary Password: ${temporaryPassword}

Your Role: ${role}
${roleDescriptions[role] || ''}

IMPORTANT: Please change your password after your first login.

Log in here: ${loginUrl}

Questions? Reply to this email for support.

- Revenue Radar Team
    `;

    return this.sendEmail({
      to: email,
      subject: '✅ Access Approved - Welcome to Revenue Radar!',
      html,
      text
    });
  }

  /**
   * Send notification when access is denied
   * @param {Object} options - { email, name, reason }
   */
  async sendAccessDeniedEmail({ email, name, reason }) {
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
          .message { font-size: 16px; color: #666; line-height: 1.6; margin: 20px 0; }
          ${reason ? `.reason-box { background: #f3f4f6; border-radius: 8px; padding: 20px; margin: 25px 0; }
          .reason-label { color: #6b7280; font-size: 13px; margin-bottom: 8px; }
          .reason-text { color: #374151; font-size: 15px; }` : ''}
          .footer { padding: 30px; text-align: center; color: #999; font-size: 14px; background: #f9f9f9; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">$</div>
            <h1 class="header-text">Revenue Radar</h1>
          </div>
          <div class="content">
            <p class="message" style="font-size: 20px; color: #333;">Hi ${name},</p>
            <p class="message">
              Thank you for your interest in Revenue Radar. After reviewing your access request,
              we're unable to approve it at this time.
            </p>
            ${reason ? `
            <div class="reason-box">
              <div class="reason-label">Additional information:</div>
              <div class="reason-text">${reason}</div>
            </div>
            ` : ''}
            <p class="message">
              If you believe this was in error or if your circumstances have changed,
              please feel free to submit a new request or reply to this email with more information.
            </p>
            <p class="message">
              Thank you for your understanding.
            </p>
          </div>
          <div class="footer">
            Revenue Radar - Sales Intelligence Platform
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
Hi ${name},

Thank you for your interest in Revenue Radar. After reviewing your access request, we're unable to approve it at this time.

${reason ? `Additional information: ${reason}` : ''}

If you believe this was in error or if your circumstances have changed, please feel free to submit a new request or reply to this email with more information.

Thank you for your understanding.

- Revenue Radar Team
    `;

    return this.sendEmail({
      to: email,
      subject: 'Revenue Radar Access Request Update',
      html,
      text
    });
  }
}

// Export singleton instance
module.exports = new EmailService();
