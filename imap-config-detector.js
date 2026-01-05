// =====================================================
// IMAP CONFIGURATION AUTO-DETECTION
// Automatically detect IMAP settings based on email domain
// =====================================================

/**
 * Common IMAP configurations for major email providers
 */
const IMAP_PROVIDERS = {
  // Gmail
  'gmail.com': {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    instructions: 'Use App Password (not your regular password). Enable 2-Step Verification first, then create App Password at https://myaccount.google.com/apppasswords'
  },
  'googlemail.com': {
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    instructions: 'Use App Password (not your regular password). Enable 2-Step Verification first, then create App Password at https://myaccount.google.com/apppasswords'
  },

  // Outlook / Hotmail / Live / Microsoft
  'outlook.com': {
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    instructions: 'Use regular email password or create App Password at https://account.microsoft.com/security'
  },
  'hotmail.com': {
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    instructions: 'Use regular email password or create App Password at https://account.microsoft.com/security'
  },
  'live.com': {
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    instructions: 'Use regular email password or create App Password at https://account.microsoft.com/security'
  },
  'msn.com': {
    host: 'outlook.office365.com',
    port: 993,
    secure: true,
    instructions: 'Use regular email password or create App Password at https://account.microsoft.com/security'
  },

  // Yahoo
  'yahoo.com': {
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    instructions: 'Generate App Password at https://login.yahoo.com/account/security - regular passwords no longer work for IMAP'
  },
  'yahoo.co.uk': {
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    instructions: 'Generate App Password at https://login.yahoo.com/account/security'
  },
  'ymail.com': {
    host: 'imap.mail.yahoo.com',
    port: 993,
    secure: true,
    instructions: 'Generate App Password at https://login.yahoo.com/account/security'
  },

  // AOL
  'aol.com': {
    host: 'imap.aol.com',
    port: 993,
    secure: true,
    instructions: 'Generate App Password at https://login.aol.com/account/security'
  },

  // iCloud
  'icloud.com': {
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    instructions: 'Generate App-Specific Password at https://appleid.apple.com/account/manage - go to Security section'
  },
  'me.com': {
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    instructions: 'Generate App-Specific Password at https://appleid.apple.com/account/manage'
  },
  'mac.com': {
    host: 'imap.mail.me.com',
    port: 993,
    secure: true,
    instructions: 'Generate App-Specific Password at https://appleid.apple.com/account/manage'
  },

  // Zoho Mail
  'zoho.com': {
    host: 'imap.zoho.com',
    port: 993,
    secure: true,
    instructions: 'Use regular email password or create App Password in Zoho settings'
  },

  // ProtonMail (via Bridge)
  'protonmail.com': {
    host: '127.0.0.1',
    port: 1143,
    secure: false,
    instructions: 'Requires ProtonMail Bridge desktop app. Download from https://protonmail.com/bridge'
  },
  'proton.me': {
    host: '127.0.0.1',
    port: 1143,
    secure: false,
    instructions: 'Requires ProtonMail Bridge desktop app. Download from https://protonmail.com/bridge'
  },

  // GMX
  'gmx.com': {
    host: 'imap.gmx.com',
    port: 993,
    secure: true,
    instructions: 'Use regular email password. Enable IMAP in GMX settings if not already enabled'
  },
  'gmx.net': {
    host: 'imap.gmx.com',
    port: 993,
    secure: true,
    instructions: 'Use regular email password'
  },

  // Mail.com
  'mail.com': {
    host: 'imap.mail.com',
    port: 993,
    secure: true,
    instructions: 'Use regular email password'
  },

  // Fastmail
  'fastmail.com': {
    host: 'imap.fastmail.com',
    port: 993,
    secure: true,
    instructions: 'Generate App Password in Fastmail settings → Password & Security'
  }
};

/**
 * Detect IMAP configuration from email address
 * @param {string} email - Full email address
 * @returns {Object} IMAP configuration
 */
function detectIMAPConfig(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }

  // Extract domain from email
  const emailLower = email.toLowerCase().trim();
  const atIndex = emailLower.lastIndexOf('@');

  if (atIndex === -1) {
    return null;
  }

  const domain = emailLower.substring(atIndex + 1);

  // Check if we have a known configuration
  const knownConfig = IMAP_PROVIDERS[domain];

  if (knownConfig) {
    return {
      email: emailLower,
      domain: domain,
      provider: getProviderName(domain),
      ...knownConfig,
      detected: true
    };
  }

  // For unknown domains, try common patterns
  return {
    email: emailLower,
    domain: domain,
    provider: 'Unknown',
    host: `imap.${domain}`,
    port: 993,
    secure: true,
    detected: false,
    instructions: `Try "imap.${domain}" or check your email provider's IMAP settings documentation. Common alternatives: "mail.${domain}" or "mx.${domain}"`
  };
}

/**
 * Get friendly provider name from domain
 * @param {string} domain - Email domain
 * @returns {string} Provider name
 */
function getProviderName(domain) {
  const providerMap = {
    'gmail.com': 'Gmail',
    'googlemail.com': 'Gmail',
    'outlook.com': 'Outlook',
    'hotmail.com': 'Hotmail',
    'live.com': 'Microsoft Live',
    'msn.com': 'MSN',
    'yahoo.com': 'Yahoo Mail',
    'yahoo.co.uk': 'Yahoo Mail',
    'ymail.com': 'Yahoo Mail',
    'aol.com': 'AOL Mail',
    'icloud.com': 'iCloud',
    'me.com': 'iCloud',
    'mac.com': 'iCloud',
    'zoho.com': 'Zoho Mail',
    'protonmail.com': 'ProtonMail',
    'proton.me': 'ProtonMail',
    'gmx.com': 'GMX',
    'gmx.net': 'GMX',
    'mail.com': 'Mail.com',
    'fastmail.com': 'Fastmail'
  };

  return providerMap[domain] || 'Custom';
}

/**
 * Test IMAP connection (basic validation)
 * @param {Object} config - IMAP configuration
 * @returns {Promise<Object>} Test result
 */
async function testIMAPConnection(config) {
  const Imap = require('imap');

  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.secure,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 10000
    });

    let connectionSuccess = false;

    imap.once('ready', () => {
      connectionSuccess = true;
      imap.end();
    });

    imap.once('error', (err) => {
      resolve({
        success: false,
        error: err.message,
        suggestion: getErrorSuggestion(err.message)
      });
    });

    imap.once('end', () => {
      if (connectionSuccess) {
        resolve({
          success: true,
          message: 'Connection successful! IMAP settings are correct.'
        });
      }
    });

    try {
      imap.connect();
    } catch (error) {
      resolve({
        success: false,
        error: error.message
      });
    }

    // Timeout after 15 seconds
    setTimeout(() => {
      if (!connectionSuccess) {
        imap.end();
        resolve({
          success: false,
          error: 'Connection timeout',
          suggestion: 'Check that IMAP is enabled for your email account and that the server address is correct'
        });
      }
    }, 15000);
  });
}

/**
 * Get helpful suggestion based on error message
 * @param {string} errorMessage - IMAP error message
 * @returns {string} Suggestion
 */
function getErrorSuggestion(errorMessage) {
  const errorLower = errorMessage.toLowerCase();

  if (errorLower.includes('invalid credentials') || errorLower.includes('authentication failed')) {
    return 'Authentication failed. For Gmail/Yahoo/Outlook, you need to use an App Password, not your regular password. Check the provider-specific instructions.';
  }

  if (errorLower.includes('getaddrinfo enotfound') || errorLower.includes('enotfound')) {
    return 'Server not found. Double-check the IMAP server address. It might be mail.yourdomain.com instead of imap.yourdomain.com';
  }

  if (errorLower.includes('timeout') || errorLower.includes('etimedout')) {
    return 'Connection timeout. Check that: 1) IMAP is enabled in your email settings, 2) Firewall isn\'t blocking port 993, 3) Server address is correct';
  }

  if (errorLower.includes('econnrefused')) {
    return 'Connection refused. The IMAP server might not be running on this address/port. Verify the port number (usually 993 for SSL, 143 for non-SSL)';
  }

  if (errorLower.includes('certificate') || errorLower.includes('ssl')) {
    return 'SSL/TLS certificate error. This is usually safe to ignore for email monitoring. The connection is still encrypted.';
  }

  return 'Check your email provider\'s IMAP settings documentation or contact your IT administrator';
}

/**
 * Get list of all supported providers
 * @returns {Array} List of providers with their details
 */
function getSupportedProviders() {
  return Object.entries(IMAP_PROVIDERS).map(([domain, config]) => ({
    domain,
    provider: getProviderName(domain),
    host: config.host,
    port: config.port,
    secure: config.secure,
    instructions: config.instructions
  }));
}

module.exports = {
  detectIMAPConfig,
  testIMAPConnection,
  getSupportedProviders,
  getProviderName
};
