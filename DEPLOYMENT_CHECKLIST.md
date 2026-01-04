# 🚀 Revenue Radar Production Deployment Checklist

Complete guide for deploying Revenue Radar to production.

---

## Pre-Deployment Checklist

### 1. Environment Setup
- [ ] Create `.env` file from `.env.example`
- [ ] Set strong `JWT_SECRET` (use `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)
- [ ] Configure `ANTHROPIC_API_KEY` with valid API key
- [ ] Set `NODE_ENV=production`
- [ ] Configure `ALLOWED_ORIGINS` for your domain
- [ ] Set `HTTPS_ENABLED=true`
- [ ] Configure SSL certificate paths
- [ ] Set `FORCE_HTTPS=true`
- [ ] Review and adjust rate limiting settings
- [ ] Configure database backup settings
- [ ] Set secure `SESSION_SECRET`

### 2. Security Hardening
- [ ] Change all default passwords
- [ ] Verify `BCRYPT_ROUNDS >= 10`
- [ ] Set `MAX_FAILED_LOGIN_ATTEMPTS=5`
- [ ] Configure `ACCOUNT_LOCKOUT_MINUTES=15`
- [ ] Review CORS `ALLOWED_ORIGINS` (remove localhost)
- [ ] Enable `TRUST_PROXY=true` (if using Nginx)
- [ ] Verify no sensitive data in code
- [ ] Remove all console.log debug statements (optional)

### 3. Database Setup
- [ ] Initialize database with `node database.js`
- [ ] Create admin user account
- [ ] Test database connectivity
- [ ] Verify all migrations ran successfully
- [ ] Create initial backup
- [ ] Set up backup directory permissions (`chmod 700 ./backups`)
- [ ] Test backup creation manually
- [ ] Verify backup retention policy

### 4. SSL/HTTPS Configuration
- [ ] Domain DNS pointed to server
- [ ] Ports 80 and 443 open in firewall
- [ ] SSL certificate obtained (Let's Encrypt recommended)
- [ ] Certificate files have correct permissions (`chmod 600 private-key.pem`)
- [ ] Auto-renewal configured (for Let's Encrypt)
- [ ] Test HTTPS connection
- [ ] Verify SSL Labs rating (A+ target)
- [ ] HTTP to HTTPS redirect working

### 5. Dependencies & Packages
- [ ] Run `npm install --production`
- [ ] Verify all dependencies installed
- [ ] Check for security vulnerabilities (`npm audit`)
- [ ] Update vulnerable packages if needed
- [ ] Remove development dependencies from production

### 6. Server Configuration
- [ ] Set up process manager (PM2, systemd)
- [ ] Configure auto-restart on crash
- [ ] Set up log rotation
- [ ] Configure server timezone (UTC recommended)
- [ ] Set file upload limits
- [ ] Configure reverse proxy (Nginx recommended)

---

## Deployment Steps

### Step 1: Server Preparation

```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install build essentials (for native modules)
sudo apt-get install -y build-essential

# Create application directory
sudo mkdir -p /var/www/revenue-radar
sudo chown $USER:$USER /var/www/revenue-radar
cd /var/www/revenue-radar
```

### Step 2: Application Deployment

```bash
# Clone or upload your application
git clone <your-repo-url> .
# OR
# scp -r /local/path/* user@server:/var/www/revenue-radar/

# Install dependencies
npm install --production

# Create required directories
mkdir -p backups
mkdir -p logs
mkdir -p uploads

# Set permissions
chmod 700 backups
chmod 755 logs
chmod 755 uploads
```

### Step 3: Environment Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit environment file
nano .env

# Generate JWT secret
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))" >> jwt-secret.txt

# Copy the generated secret to .env JWT_SECRET
# Then delete the temporary file
rm jwt-secret.txt
```

### Step 4: Database Initialization

```bash
# Initialize database
node database.js

# Create admin user (interactive)
node scripts/create-admin.js

# Create initial backup
node scripts/backup-now.js
```

### Step 5: SSL Certificate Setup (Let's Encrypt)

```bash
# Install Certbot
sudo apt-get install certbot -y

# Stop Node.js if running
sudo systemctl stop revenue-radar

# Obtain certificate
sudo certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Set up auto-renewal
sudo crontab -e
# Add: 0 0,12 * * * certbot renew --quiet --post-hook "systemctl restart revenue-radar"

# Update .env with certificate paths
# SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
# SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
```

### Step 6: Install & Configure PM2

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start application with PM2
pm2 start server.js --name revenue-radar

# Set up auto-start on boot
pm2 startup systemd
# Run the command that PM2 outputs

# Save PM2 process list
pm2 save

# Monitor application
pm2 monit
```

### Step 7: Configure Nginx Reverse Proxy

```bash
# Install Nginx
sudo apt-get install nginx -y

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/revenue-radar
```

Paste this configuration:

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
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Proxy to Node.js
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
    }

    # Health check
    location /health {
        proxy_pass http://localhost:5050/health;
        access_log off;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/revenue-radar /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Enable Nginx auto-start
sudo systemctl enable nginx
```

### Step 8: Firewall Configuration

```bash
# Install UFW (if not installed)
sudo apt-get install ufw -y

# Allow SSH (important!)
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

---

## Post-Deployment Verification

### 1. Application Health

```bash
# Check if PM2 is running
pm2 status

# View logs
pm2 logs revenue-radar --lines 100

# Check for errors
pm2 logs revenue-radar --err --lines 50
```

### 2. HTTP/HTTPS Testing

```bash
# Test HTTP redirect
curl -I http://yourdomain.com

# Test HTTPS
curl -I https://yourdomain.com

# Test health endpoint
curl https://yourdomain.com/health

# Verify SSL
openssl s_client -connect yourdomain.com:443 -servername yourdomain.com
```

### 3. Database & Backups

```bash
# Verify database exists
ls -lh revenue-radar.db

# Check backup directory
ls -lh backups/

# Test manual backup
curl -X POST https://yourdomain.com/backups \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

### 4. Security Testing

- [ ] Visit https://www.ssllabs.com/ssltest/ and test your domain (target: A+)
- [ ] Verify HSTS header present
- [ ] Test rate limiting by making rapid requests
- [ ] Attempt SQL injection on login form
- [ ] Test XSS in form inputs
- [ ] Verify CORS only allows configured origins
- [ ] Test authentication with invalid tokens
- [ ] Verify role-based access control (admin vs rep)

### 5. Functional Testing

- [ ] Register new user account
- [ ] Login with valid credentials
- [ ] Login with invalid credentials (should fail after 5 attempts)
- [ ] Access admin dashboard
- [ ] Create/edit/delete users (admin only)
- [ ] Test email invoice ingestion
- [ ] Verify AI analysis working
- [ ] Test all dashboard features
- [ ] Create manual backup
- [ ] Test backup download
- [ ] Verify error logging

### 6. Performance Testing

```bash
# Monitor memory usage
pm2 monit

# Check database size
du -h revenue-radar.db

# Monitor system resources
htop

# Test concurrent connections (install apache2-utils)
ab -n 1000 -c 10 https://yourdomain.com/health
```

---

## Monitoring Setup

### 1. Application Monitoring

```bash
# Install PM2 monitoring (optional)
pm2 install pm2-logrotate

# Configure log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

### 2. Health Check Monitoring

Set up external monitoring service (UptimeRobot, Pingdom, etc.):
- Monitor: `https://yourdomain.com/health`
- Expected response: 200 OK
- Check interval: 5 minutes
- Alert on downtime

### 3. Certificate Expiration Monitoring

```bash
# Check certificate expiration
openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -noout -enddate

# Set up expiration alert (add to crontab)
0 0 * * 0 /usr/local/bin/check-cert-expiration.sh
```

### 4. Disk Space Monitoring

```bash
# Add to crontab for weekly disk space check
0 0 * * 0 df -h | mail -s "Disk Space Report" admin@yourdomain.com
```

---

## Backup & Recovery

### Automated Backups

Backups are automated via the backup service (configured in `.env`):
- Runs every `DATABASE_BACKUP_INTERVAL_HOURS`
- Retains backups for `DATABASE_BACKUP_RETENTION_DAYS`
- Stored in `DATABASE_BACKUP_PATH`

### Manual Backup

```bash
# Via API (requires admin token)
curl -X POST https://yourdomain.com/backups \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"

# Via script
node scripts/backup-now.js
```

### Restore from Backup

```bash
# 1. Stop the application
pm2 stop revenue-radar

# 2. Restore via API
curl -X POST https://yourdomain.com/backups/restore \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"filename":"revenue-radar-2024-01-15T10-00-00-000Z.db"}'

# 3. Restart application
pm2 restart revenue-radar

# OR manually:
# cp backups/revenue-radar-TIMESTAMP.db revenue-radar.db
# pm2 restart revenue-radar
```

### Offsite Backup (S3)

To enable S3 backups:

```bash
# Install AWS SDK
npm install aws-sdk

# Configure in .env
S3_BACKUP_ENABLED=true
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_S3_BUCKET=revenue-radar-backups
```

---

## Troubleshooting

### Application Won't Start

```bash
# Check PM2 logs
pm2 logs revenue-radar --lines 100

# Check for port conflicts
sudo lsof -i :5050

# Verify environment variables
pm2 env revenue-radar

# Test configuration
node config.js
```

### Database Errors

```bash
# Check database file permissions
ls -l revenue-radar.db

# Verify database integrity
sqlite3 revenue-radar.db "PRAGMA integrity_check;"

# Restore from backup if corrupted
pm2 stop revenue-radar
cp backups/revenue-radar-LATEST.db revenue-radar.db
pm2 restart revenue-radar
```

### SSL Certificate Issues

```bash
# Renew certificate
sudo certbot renew --force-renewal

# Restart services
sudo systemctl restart nginx
pm2 restart revenue-radar

# Check certificate
sudo certbot certificates
```

### High Memory Usage

```bash
# Restart application
pm2 restart revenue-radar

# Enable cluster mode (multiple instances)
pm2 delete revenue-radar
pm2 start server.js -i max --name revenue-radar

# Monitor memory
pm2 monit
```

### Rate Limiting False Positives

```bash
# Increase rate limits in .env
RATE_LIMIT_MAX_REQUESTS=200
LOGIN_RATE_LIMIT_MAX_REQUESTS=10

# Restart application
pm2 restart revenue-radar
```

---

## Maintenance Tasks

### Daily
- [ ] Check PM2 status (`pm2 status`)
- [ ] Review error logs (`pm2 logs revenue-radar --err`)
- [ ] Monitor disk space (`df -h`)

### Weekly
- [ ] Review backup logs
- [ ] Check backup directory size
- [ ] Review health check metrics
- [ ] Monitor user activity
- [ ] Check for failed login attempts

### Monthly
- [ ] Update npm packages (`npm update`)
- [ ] Review and rotate logs
- [ ] Test backup restoration
- [ ] Review security settings
- [ ] Check SSL certificate expiration
- [ ] Review rate limiting effectiveness
- [ ] Analyze error patterns

### Quarterly
- [ ] Full security audit
- [ ] Performance optimization review
- [ ] Database optimization (`VACUUM`)
- [ ] Review and update documentation
- [ ] Disaster recovery drill

---

## Update Procedure

### 1. Pre-Update

```bash
# Create backup
node scripts/backup-now.js

# Test on staging environment first
# ...

# Announce maintenance window to users
```

### 2. Deploy Update

```bash
# Pull latest code
git pull origin main

# Install new dependencies
npm install --production

# Run database migrations (if any)
node migrations/run.js

# Restart application
pm2 restart revenue-radar

# Monitor logs
pm2 logs revenue-radar --lines 50
```

### 3. Post-Update Verification

- [ ] Check application starts successfully
- [ ] Verify health endpoint responds
- [ ] Test critical features
- [ ] Monitor error logs for 15 minutes
- [ ] Check database integrity
- [ ] Verify backups still working

### 4. Rollback Plan (if issues)

```bash
# Stop application
pm2 stop revenue-radar

# Restore previous version
git reset --hard <previous-commit-hash>

# Restore database if needed
cp backups/revenue-radar-pre-update.db revenue-radar.db

# Restart
pm2 restart revenue-radar
```

---

## Security Incident Response

### If Security Breach Suspected

1. **Immediate Actions**
   ```bash
   # Stop application
   pm2 stop revenue-radar

   # Backup current state (for investigation)
   cp revenue-radar.db breach-investigation-$(date +%Y%m%d).db

   # Block suspicious IPs in firewall
   sudo ufw deny from <suspicious-ip>
   ```

2. **Investigation**
   - Review error logs: `pm2 logs revenue-radar`
   - Check access logs in Nginx: `/var/log/nginx/access.log`
   - Review failed login attempts in database
   - Check for unusual database modifications
   - Review recent backups for clean state

3. **Remediation**
   - Change all passwords (JWT secrets, admin accounts)
   - Revoke all active sessions
   - Restore from clean backup if needed
   - Patch vulnerability
   - Update security settings

4. **Post-Incident**
   - Document incident details
   - Implement additional monitoring
   - Update security procedures
   - Notify affected users if required

---

## Performance Optimization

### Database Optimization

```bash
# Vacuum database (reclaim space)
sqlite3 revenue-radar.db "VACUUM;"

# Analyze tables
sqlite3 revenue-radar.db "ANALYZE;"

# Check database size
du -h revenue-radar.db
```

### Node.js Optimization

```bash
# Enable cluster mode (use all CPU cores)
pm2 delete revenue-radar
pm2 start server.js -i max --name revenue-radar

# Set memory limit
pm2 start server.js --name revenue-radar --max-memory-restart 500M
```

### Nginx Optimization

Add to Nginx config:
```nginx
# Enable gzip compression
gzip on;
gzip_types text/plain text/css application/json application/javascript;

# Enable caching
location /static/ {
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

---

## Production Readiness Checklist

### Security ✅
- [ ] HTTPS enabled with valid SSL certificate
- [ ] Strong JWT secret configured
- [ ] CORS properly configured
- [ ] Rate limiting enabled
- [ ] SQL injection protection verified
- [ ] XSS protection enabled
- [ ] CSRF protection implemented
- [ ] Security headers configured
- [ ] Firewall configured
- [ ] Regular security updates scheduled

### Reliability ✅
- [ ] Process manager configured (PM2)
- [ ] Auto-restart on crash enabled
- [ ] Database backups automated
- [ ] Health check endpoint working
- [ ] Error logging implemented
- [ ] Monitoring alerts set up
- [ ] Uptime monitoring configured

### Performance ✅
- [ ] Database indexed properly
- [ ] Nginx reverse proxy configured
- [ ] Gzip compression enabled
- [ ] Rate limiting tuned appropriately
- [ ] Memory limits configured
- [ ] Cluster mode enabled (if needed)

### Operations ✅
- [ ] Deployment documentation complete
- [ ] Rollback procedure tested
- [ ] Backup restoration tested
- [ ] Monitoring dashboards set up
- [ ] Alert notifications configured
- [ ] Maintenance procedures documented
- [ ] Incident response plan ready

---

## Quick Reference Commands

```bash
# PM2 Management
pm2 status                          # Check application status
pm2 logs revenue-radar             # View logs
pm2 restart revenue-radar          # Restart application
pm2 monit                          # Monitor resources
pm2 save                           # Save process list

# Database
sqlite3 revenue-radar.db           # Open database
node scripts/backup-now.js         # Manual backup
ls -lh backups/                    # List backups

# Nginx
sudo nginx -t                      # Test configuration
sudo systemctl restart nginx       # Restart Nginx
sudo tail -f /var/log/nginx/error.log  # View errors

# SSL Certificate
sudo certbot renew                 # Renew certificate
sudo certbot certificates          # List certificates

# System
sudo ufw status                    # Check firewall
htop                              # Monitor resources
df -h                             # Check disk space
```

---

## Support & Resources

- **Application Logs:** `pm2 logs revenue-radar`
- **Nginx Logs:** `/var/log/nginx/`
- **Database Location:** `./revenue-radar.db`
- **Backups Location:** `./backups/`
- **Configuration:** `.env`

**Need help?** Review the troubleshooting section or contact your system administrator.

---

**Last Updated:** 2024-01-03
**Version:** 1.0.0
