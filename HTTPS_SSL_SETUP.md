# 🔒 HTTPS/SSL Setup Guide

## Production HTTPS Setup for Revenue Radar

This guide covers setting up HTTPS/SSL certificates for production deployment.

---

## Option 1: Let's Encrypt (Free, Recommended)

Let's Encrypt provides **free, automated SSL certificates** that renew automatically.

### Prerequisites:
- Domain name pointed to your server
- Port 80 and 443 open
- Root/sudo access

### Installation Steps:

#### 1. Install Certbot

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install certbot

# CentOS/RHEL
sudo yum install certbot
```

#### 2. Get SSL Certificate

```bash
# Stop your Node.js server first
sudo service revenue-radar stop

# Get certificate (replace yourdomain.com)
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Certificates will be saved to:
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem
```

#### 3. Update .env Configuration

```env
HTTPS_ENABLED=true
SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
FORCE_HTTPS=true
```

#### 4. Set Up Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Add to crontab for auto-renewal
sudo crontab -e

# Add this line (runs twice daily):
0 0,12 * * * certbot renew --quiet --post-hook "systemctl restart revenue-radar"
```

---

## Option 2: Commercial SSL Certificate

If you purchased an SSL certificate from a provider (GoDaddy, Namecheap, etc.):

### 1. Generate CSR (Certificate Signing Request)

```bash
# Create directory for SSL files
mkdir -p /etc/ssl/revenue-radar
cd /etc/ssl/revenue-radar

# Generate private key
openssl genrsa -out private-key.pem 2048

# Generate CSR
openssl req -new -key private-key.pem -out csr.pem

# Follow prompts:
# - Country: US
# - State: California
# - City: San Francisco
# - Organization: Your Company
# - Common Name: yourdomain.com
# - Email: admin@yourdomain.com
```

### 2. Submit CSR to Provider

Copy the contents of `csr.pem` and submit to your SSL provider.

### 3. Download Certificate Files

Your provider will give you:
- `certificate.crt` - Your certificate
- `ca-bundle.crt` - Certificate Authority bundle

### 4. Install Certificates

```bash
# Copy files to server
sudo mkdir -p /etc/ssl/revenue-radar
sudo cp certificate.crt /etc/ssl/revenue-radar/
sudo cp ca-bundle.crt /etc/ssl/revenue-radar/
sudo cp private-key.pem /etc/ssl/revenue-radar/

# Set permissions
sudo chmod 600 /etc/ssl/revenue-radar/private-key.pem
sudo chmod 644 /etc/ssl/revenue-radar/certificate.crt
```

### 5. Update .env

```env
HTTPS_ENABLED=true
SSL_CERT_PATH=/etc/ssl/revenue-radar/certificate.crt
SSL_KEY_PATH=/etc/ssl/revenue-radar/private-key.pem
SSL_CA_PATH=/etc/ssl/revenue-radar/ca-bundle.crt
FORCE_HTTPS=true
```

---

## Option 3: Self-Signed Certificate (Development/Testing Only)

⚠️ **Not recommended for production!** Browsers will show security warnings.

### Generate Self-Signed Certificate

```bash
# Create SSL directory
mkdir -p ./ssl
cd ./ssl

# Generate certificate (valid for 365 days)
openssl req -x509 -newkey rsa:4096 -keyout private-key.pem -out certificate.pem -days 365 -nodes

# Follow prompts
```

### Update .env

```env
HTTPS_ENABLED=true
SSL_CERT_PATH=./ssl/certificate.pem
SSL_KEY_PATH=./ssl/private-key.pem
```

---

## Server Configuration

### Update server.js to Support HTTPS

```javascript
const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const config = require('./config');

const app = express();

// ... your app configuration ...

// Start server
if (config.httpsEnabled) {
  // HTTPS server
  const httpsOptions = {
    key: fs.readFileSync(config.sslConfig.keyPath),
    cert: fs.readFileSync(config.sslConfig.certPath)
  };

  // Add CA bundle if provided
  if (config.sslConfig.caPath && fs.existsSync(config.sslConfig.caPath)) {
    httpsOptions.ca = fs.readFileSync(config.sslConfig.caPath);
  }

  https.createServer(httpsOptions, app).listen(443, () => {
    console.log('✅ HTTPS server running on port 443');
  });

  // HTTP to HTTPS redirect
  if (config.forceHttps) {
    http.createServer((req, res) => {
      res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
      res.end();
    }).listen(80, () => {
      console.log('✅ HTTP redirect server running on port 80');
    });
  }

} else {
  // HTTP only (development)
  app.listen(config.port, () => {
    console.log(`✅ HTTP server running on port ${config.port}`);
  });
}
```

---

## Nginx Reverse Proxy (Recommended for Production)

Using Nginx as a reverse proxy provides better performance and easier SSL management.

### 1. Install Nginx

```bash
sudo apt-get update
sudo apt-get install nginx
```

### 2. Configure Nginx

Create `/etc/nginx/sites-available/revenue-radar`:

```nginx
# HTTP to HTTPS redirect
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    return 301 https://$server_name$request_uri;
}

# HTTPS server
server {
    listen 443 ssl http2;
    server_name yourdomain.com www.yourdomain.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Node.js app
    location / {
        proxy_pass http://localhost:5050;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Static files (optional)
    location /static/ {
        alias /path/to/revenue-radar/static/;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Health check endpoint
    location /health {
        proxy_pass http://localhost:5050/health;
        access_log off;
    }
}
```

### 3. Enable Site

```bash
# Create symlink
sudo ln -s /etc/nginx/sites-available/revenue-radar /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

### 4. Update .env for Nginx Setup

```env
# Node.js runs on localhost only
PORT=5050
HOST=localhost

# Nginx handles HTTPS
HTTPS_ENABLED=false

# Trust proxy headers
TRUST_PROXY=true
```

---

## Testing HTTPS Setup

### 1. Test SSL Configuration

```bash
# Test with curl
curl -I https://yourdomain.com

# Test SSL handshake
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

### 2. Online SSL Checkers

- **SSL Labs:** https://www.ssllabs.com/ssltest/
- **SSL Shopper:** https://www.sslshopper.com/ssl-checker.html

### 3. Browser Test

- Visit https://yourdomain.com
- Click the padlock icon
- Verify certificate is valid and trusted

---

## Security Best Practices

### 1. Strong SSL Configuration

```env
# Use TLS 1.2 and 1.3 only
SSL_MIN_VERSION=TLSv1.2

# Disable weak ciphers
SSL_CIPHERS=ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512
```

### 2. HTTP Strict Transport Security (HSTS)

Already included in security headers. Tells browsers to always use HTTPS.

### 3. Certificate Monitoring

Set up monitoring to alert before certificate expiration:

```bash
# Check certificate expiration
openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -noout -enddate
```

### 4. Regular Updates

```bash
# Keep certbot updated
sudo apt-get update && sudo apt-get upgrade certbot
```

---

## Troubleshooting

### Error: "Certificate has expired"

```bash
# Renew certificate
sudo certbot renew --force-renewal
sudo systemctl restart nginx
```

### Error: "NET::ERR_CERT_AUTHORITY_INVALID"

- Using self-signed certificate (browsers don't trust it)
- Missing CA bundle
- Solution: Use Let's Encrypt or commercial certificate

### Error: "Mixed content warnings"

- Some resources loading over HTTP instead of HTTPS
- Solution: Update all resource URLs to use HTTPS or relative paths

### Port 443 Already in Use

```bash
# Check what's using port 443
sudo lsof -i :443

# Stop the service
sudo systemctl stop <service-name>
```

---

## Production Checklist

- [ ] SSL certificate installed and valid
- [ ] Auto-renewal configured (Let's Encrypt)
- [ ] HTTP to HTTPS redirect enabled
- [ ] HSTS header configured
- [ ] SSL Labs test shows A+ rating
- [ ] Certificate expiration monitoring set up
- [ ] Nginx configured (if using reverse proxy)
- [ ] Firewall allows ports 80 and 443
- [ ] All environment variables updated
- [ ] Test on multiple browsers
- [ ] Mobile test completed

---

## Additional Resources

- **Let's Encrypt:** https://letsencrypt.org/getting-started/
- **Certbot Documentation:** https://certbot.eff.org/
- **Mozilla SSL Configuration Generator:** https://ssl-config.mozilla.org/
- **HSTS Preload:** https://hstspreload.org/

---

**Need help?** Contact your hosting provider or system administrator for SSL setup assistance.
