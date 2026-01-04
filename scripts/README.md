# Scripts Directory

Utility scripts for managing Revenue Radar in production.

---

## Available Scripts

### 1. setup-production.sh
**Automated production environment setup**

```bash
./scripts/setup-production.sh
```

This script will:
- Check Node.js installation
- Install dependencies
- Create required directories
- Set up .env configuration
- Generate JWT secret
- Initialize database
- Create admin user
- Create initial backup
- Run health check
- Optionally set up PM2

**When to use:** First-time production deployment

---

### 2. create-admin.js
**Create a new admin user interactively**

```bash
node scripts/create-admin.js
```

Prompts for:
- Email address
- Full name
- Password (with validation)
- Account name

**When to use:**
- Creating the first admin account
- Adding additional admin users
- Recovering access after losing credentials

---

### 3. backup-now.js
**Create an immediate database backup**

```bash
node scripts/backup-now.js
```

Output:
- Backup filename
- File location
- Backup size

**When to use:**
- Before major updates
- Before database migrations
- Before restoring from backup
- Manual backup outside of schedule

---

### 4. list-backups.js
**List all available database backups**

```bash
node scripts/list-backups.js
```

Shows:
- All backup files
- File sizes
- Creation dates
- Age of each backup
- Total backup statistics

**When to use:**
- Checking backup status
- Finding a specific backup to restore
- Monitoring backup storage usage

---

### 5. check-health.js
**Run a local health check**

```bash
node scripts/check-health.js
```

Checks:
- Database connectivity
- Memory usage
- CPU load
- Backup status
- Configuration

Exit codes:
- 0: All healthy
- 1: Issues detected

**When to use:**
- Troubleshooting performance issues
- Verifying system status
- Before/after deployments
- In automated monitoring scripts

---

### 6. generate-jwt-secret.js
**Generate a cryptographically secure JWT secret**

```bash
node scripts/generate-jwt-secret.js
```

Output:
- 128-character hex string
- Ready to paste into .env

**When to use:**
- Initial setup
- Rotating secrets for security
- After security incidents

---

## Usage Examples

### First-Time Production Setup

```bash
# 1. Run automated setup
./scripts/setup-production.sh

# 2. Generate SSL certificates
sudo certbot certonly --standalone -d yourdomain.com

# 3. Start with PM2
pm2 start server.js --name revenue-radar
pm2 save
```

### Before Major Update

```bash
# 1. Create backup
node scripts/backup-now.js

# 2. Check system health
node scripts/check-health.js

# 3. Deploy update
git pull origin main
npm install --production
pm2 restart revenue-radar

# 4. Verify health
node scripts/check-health.js
```

### Recovering from Issues

```bash
# 1. Check current health
node scripts/check-health.js

# 2. List available backups
node scripts/list-backups.js

# 3. Restore from backup (via API or manual copy)
# See DEPLOYMENT_CHECKLIST.md for restore procedure

# 4. Verify restoration
node scripts/check-health.js
```

### Security Incident Response

```bash
# 1. Create immediate backup
node scripts/backup-now.js

# 2. Generate new JWT secret
node scripts/generate-jwt-secret.js

# 3. Update .env with new secret
nano .env

# 4. Create new admin user
node scripts/create-admin.js

# 5. Restart application
pm2 restart revenue-radar
```

### Regular Maintenance

```bash
# Weekly health check
node scripts/check-health.js

# Weekly backup verification
node scripts/list-backups.js

# Monthly manual backup
node scripts/backup-now.js
```

---

## Automation

### Cron Jobs

Add to crontab (`crontab -e`):

```cron
# Daily health check (8 AM)
0 8 * * * cd /var/www/revenue-radar && node scripts/check-health.js >> logs/health.log 2>&1

# Weekly backup report (Monday 9 AM)
0 9 * * 1 cd /var/www/revenue-radar && node scripts/list-backups.js | mail -s "Backup Report" admin@yourdomain.com

# Monthly manual backup (1st of month, midnight)
0 0 1 * * cd /var/www/revenue-radar && node scripts/backup-now.js >> logs/manual-backups.log 2>&1
```

### PM2 Scripts

Create `ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'revenue-radar',
    script: './server.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    }
  }],

  deploy: {
    production: {
      user: 'deploy',
      host: 'yourdomain.com',
      ref: 'origin/main',
      repo: 'git@github.com:yourname/revenue-radar.git',
      path: '/var/www/revenue-radar',
      'post-deploy': 'npm install --production && node scripts/backup-now.js && pm2 reload ecosystem.config.js'
    }
  }
};
```

---

## Script Permissions

All scripts should be executable:

```bash
chmod +x scripts/*.sh
```

Node scripts don't need execute permission but can be made executable:

```bash
chmod +x scripts/*.js
```

Then run with shebang:

```bash
./scripts/create-admin.js
```

---

## Environment Requirements

All scripts require:
- Node.js 18+
- Access to project root directory
- Properly configured .env file (except setup script)

Some scripts require:
- Database file exists (create-admin, backup-now)
- Write permissions (backup-now, setup-production)
- Network access (check-health with external dependencies)

---

## Troubleshooting

### "Cannot find module"

```bash
# Install dependencies
npm install

# Or production only
npm install --production
```

### "Database not found"

```bash
# Initialize database
node database.js
```

### "Permission denied"

```bash
# Make scripts executable
chmod +x scripts/*.sh

# Check directory permissions
ls -la backups/
chmod 700 backups
```

### "JWT_SECRET not set"

```bash
# Generate and set secret
node scripts/generate-jwt-secret.js

# Copy output to .env
nano .env
```

---

## Best Practices

1. **Always backup before changes**
   ```bash
   node scripts/backup-now.js
   ```

2. **Check health after deployments**
   ```bash
   node scripts/check-health.js
   ```

3. **Keep scripts updated**
   - Review scripts after major version updates
   - Test scripts in staging before production

4. **Monitor script outputs**
   - Log script executions
   - Set up alerts for failures
   - Review logs regularly

5. **Secure script execution**
   - Don't commit .env files
   - Restrict script access to authorized users
   - Use proper file permissions

---

## Contributing

When adding new scripts:
1. Add shebang line: `#!/usr/bin/env node` or `#!/bin/bash`
2. Add header comment block with description
3. Handle errors gracefully
4. Provide clear output messages
5. Update this README
6. Test thoroughly before committing

---

**Last Updated:** 2024-01-03
