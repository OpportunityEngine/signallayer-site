# 🚀 Revenue Radar - Complete Deployment Guide

This guide will take you from local development to a live, production website in about 30 minutes.

---

## 📋 What You'll Need

- **GitHub Account** (free) - [Sign up here](https://github.com/join)
- **DigitalOcean Account** - [Sign up here](https://www.digitalocean.com/)
- **Domain Name** (optional for now, $10-15/year)
- **Your Anthropic API Key**

**Total Cost**: ~$12/month + $12/year for domain

---

## 🎯 Step 1: Push Code to GitHub

Your code needs to be on GitHub so DigitalOcean can deploy it automatically.

### Option A: Use the Setup Script (Easiest)

```bash
cd /Users/taylorray/Desktop/ai-sales-backend
./scripts/setup-github.sh
```

The script will:
1. Initialize Git repository
2. Create initial commit
3. Prompt you for your GitHub repository URL
4. Push everything to GitHub

### Option B: Manual Setup

```bash
# 1. Go to https://github.com/new
# 2. Create a new PRIVATE repository called "revenue-radar"
# 3. Do NOT initialize with README

# 4. Run these commands:
git init
git add .
git commit -m "Initial commit - Revenue Radar"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/revenue-radar.git
git push -u origin main
```

✅ **Checkpoint**: Your code should now be visible on GitHub

---

## 🎯 Step 2: Create DigitalOcean App

### 1. Sign Up for DigitalOcean

- Go to [https://www.digitalocean.com/](https://www.digitalocean.com/)
- Sign up (you may get $200 free credit for 60 days)
- Verify your email and add payment method

### 2. Create New App

1. Click **"Create"** → **"Apps"**
2. Click **"Create App"**
3. Choose **"GitHub"** as source
4. Click **"Manage Access"** and authorize DigitalOcean
5. Select your **revenue-radar** repository
6. Select **main** branch
7. Check **"Autodeploy"** (deploys automatically when you push updates)
8. Click **"Next"**

### 3. Configure App Settings

DigitalOcean should auto-detect:
- **Type**: Web Service
- **Branch**: main
- **Build Command**: `npm install`
- **Run Command**: `npm start`
- **HTTP Port**: `5050`

If not, set these manually.

Click **"Edit Plan"** and select:
- **Basic Plan**: $12/month
- **Size**: Basic (512 MB RAM, 1 vCPU)

Click **"Next"**

### 4. Set Environment Variables

Click **"Edit"** next to Environment Variables and add these:

**Required Variables:**

```
NODE_ENV = production
PORT = 5050
TRUST_PROXY = true
```

**Security (Generate New Secrets!):**

Generate two new secrets by running this on your Mac:
```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

Add them as **encrypted** environment variables in DigitalOcean:
```
JWT_SECRET = [paste the generated JWT secret]
SESSION_SECRET = [paste the generated session secret]
ANTHROPIC_API_KEY = [your Anthropic API key]
```

Mark these as **encrypted** (click the encrypt checkbox).

**Other Variables:**

```
BCRYPT_ROUNDS = 12
MAX_FAILED_LOGIN_ATTEMPTS = 5
ACCOUNT_LOCKOUT_MINUTES = 15
JWT_EXPIRES_IN = 24h
REFRESH_TOKEN_EXPIRES_IN = 30d
DATABASE_PATH = /data/revenue-radar.db
DATABASE_BACKUP_PATH = /data/backups
DATABASE_BACKUP_ENABLED = true
DATABASE_BACKUP_INTERVAL_HOURS = 12
WEB_SCRAPER_ENABLE = 1
OSM_ENABLE = 1
ALLOWED_ORIGINS = https://revenue-radar-XXXXX.ondigitalocean.app
```

**Note**: You'll update `ALLOWED_ORIGINS` after deployment with your actual URL.

Click **"Save"** and **"Next"**

### 5. Review and Deploy

1. App name: `revenue-radar` (or your choice)
2. Region: **New York** (or closest to you)
3. Review pricing: ~$12/month
4. Click **"Create Resources"**

⏱️ **Wait 5-10 minutes** for deployment...

---

## 🎯 Step 3: Verify Deployment

### 1. Get Your App URL

After deployment completes:
- You'll see a URL like: `https://revenue-radar-xxxxx.ondigitalocean.app`
- Click on it!

### 2. Test Health Endpoint

```bash
curl https://your-app-url.ondigitalocean.app/health
```

Should return:
```json
{
  "status": "healthy",
  "timestamp": "...",
  "uptime": 123.45
}
```

### 3. Create Admin User

You need to create your first admin user. There are two ways:

#### Option A: Use DigitalOcean Console

1. Go to your app in DigitalOcean
2. Click **"Console"** tab
3. Click **"Open Console"**
4. Run:
```bash
node scripts/create-admin.js
```

Follow the prompts to create your admin account.

#### Option B: Create via API (Temporary)

For the very first admin, you can temporarily allow registration, then lock it down:

1. Go to [auth-routes.js](auth-routes.js) line 88
2. Temporarily change `role: 'rep'` to `role: 'admin'`
3. Commit and push (DigitalOcean will auto-deploy)
4. Use your login page to register as admin
5. Change it back to `role: 'rep'` and push again

### 4. Update CORS Origins

1. Copy your actual app URL
2. Go to DigitalOcean → Your App → Settings → Environment Variables
3. Update `ALLOWED_ORIGINS`:
```
ALLOWED_ORIGINS = https://your-actual-app-url.ondigitalocean.app
```
4. Click **"Save"** (app will restart)

### 5. Test Login

1. Go to `https://your-app-url.ondigitalocean.app/dashboard/login.html`
2. Login with your admin credentials
3. You should be redirected to the manager dashboard!

✅ **Your app is now LIVE!** 🎉

---

## 🎯 Step 4: Add Custom Domain (Optional)

### 1. Buy a Domain

**Recommended registrars:**
- [Namecheap](https://www.namecheap.com/) - ~$10/year
- [Google Domains](https://domains.google/) - ~$12/year
- [Cloudflare](https://www.cloudflare.com/products/registrar/) - ~$9/year

Buy a domain like:
- `revenueradar.com`
- `yourcompany.com`
- Whatever you want!

### 2. Add Domain to DigitalOcean

1. Go to your app in DigitalOcean
2. Click **"Settings"** tab
3. Scroll to **"Domains"**
4. Click **"Add Domain"**
5. Enter your domain: `yourdomain.com`
6. DigitalOcean will show you DNS records to add

### 3. Configure DNS

Go to your domain registrar (Namecheap, Google, etc.) and add these DNS records:

**For root domain (yourdomain.com):**
```
Type: CNAME
Host: @
Value: [DigitalOcean shows you this]
```

**For www subdomain (www.yourdomain.com):**
```
Type: CNAME
Host: www
Value: [DigitalOcean shows you this]
```

**DNS propagation takes 5-60 minutes**

### 4. Enable HTTPS (Automatic!)

DigitalOcean automatically:
- Generates SSL certificate (free from Let's Encrypt)
- Configures HTTPS
- Redirects HTTP → HTTPS

✅ Your site is now on your custom domain with HTTPS! 🔒

### 5. Update ALLOWED_ORIGINS Again

Update the environment variable in DigitalOcean:
```
ALLOWED_ORIGINS = https://yourdomain.com,https://www.yourdomain.com
```

---

## 🎯 Step 5: Making Updates

This is the BEST part - you can edit code on your Mac and it automatically deploys!

### Making Changes

```bash
# 1. Make your changes in VSCode or any editor

# 2. Commit changes
git add .
git commit -m "Updated dashboard colors"

# 3. Push to GitHub
git push

# 4. DigitalOcean automatically deploys! ⚡
```

**That's it!** Your changes will be live in 2-3 minutes.

### Monitoring Deployments

1. Go to DigitalOcean → Your App
2. Click **"Deployments"** tab
3. Watch real-time build logs
4. See when deployment completes

---

## 📊 Monitoring Your App

### Health Check

```bash
curl https://yourdomain.com/health
```

### View Logs

1. Go to DigitalOcean → Your App
2. Click **"Runtime Logs"** tab
3. See real-time server logs

### Check Metrics

1. Click **"Insights"** tab
2. See:
   - CPU usage
   - Memory usage
   - Request counts
   - Response times

---

## 🔒 Security Checklist

- ✅ HTTPS automatically enabled by DigitalOcean
- ✅ JWT secrets are encrypted environment variables
- ✅ Database backups run every 12 hours
- ✅ Rate limiting enabled on login endpoints
- ✅ Account lockout after 5 failed login attempts
- ✅ CORS restricted to your domain only
- ✅ GitHub repository is PRIVATE

**Additional Recommendations:**

1. **Enable 2FA on GitHub** - [Enable here](https://github.com/settings/security)
2. **Enable 2FA on DigitalOcean** - Account → Security
3. **Review audit logs regularly** - Check `/api/audit-logs`

---

## 💰 Cost Breakdown

### Monthly Costs

| Service | Cost | What it does |
|---------|------|--------------|
| DigitalOcean App Platform | $12/month | Hosts your app 24/7 |
| Domain (annual/12) | ~$1/month | Your custom domain |
| **Total** | **~$13/month** | |

### Optional Upgrades (When You Scale)

| Service | Cost | When you need it |
|---------|------|------------------|
| Managed PostgreSQL | +$15/month | 1000+ users |
| Managed Redis | +$15/month | Session storage |
| Spaces (S3 storage) | +$5/month | Backup storage |
| Professional Plan | +$12/month | More resources |

---

## 🆘 Troubleshooting

### Build Failed

**Check build logs:**
1. DigitalOcean → Your App → Deployments
2. Click failed deployment
3. Read error message

**Common fixes:**
- Missing dependencies: Make sure [package.json](package.json) has all packages
- Syntax error: Check your latest changes
- Environment variable missing: Add it in Settings

### App Won't Start

**Check runtime logs:**
1. DigitalOcean → Your App → Runtime Logs
2. Look for error messages

**Common issues:**
- Database path not writable: Check `DATABASE_PATH` env var
- Missing environment variable: Add in Settings
- Port conflict: Make sure `PORT=5050`

### Can't Login

**Checklist:**
1. Did you create an admin user?
2. Is `ALLOWED_ORIGINS` set correctly?
3. Check browser console for CORS errors
4. Try clearing cookies and cache

### Domain Not Working

**Checklist:**
1. Wait 30-60 minutes for DNS propagation
2. Check DNS records in your registrar
3. Verify CNAME points to DigitalOcean URL
4. Try `https://` not `http://`

---

## 🎓 Useful Commands

### Generate New Secrets
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Test Health Endpoint
```bash
curl https://yourdomain.com/health
```

### Create Admin User (via Console)
```bash
node scripts/create-admin.js
```

### Check Backups (via Console)
```bash
node scripts/list-backups.js
```

### Manual Backup (via Console)
```bash
node scripts/backup-now.js
```

---

## 📚 Next Steps

After deployment, consider:

1. **Set up monitoring alerts** - DigitalOcean → Monitoring → Alerts
2. **Configure email service** - For password resets
3. **Add S3 backup storage** - For offsite backups
4. **Upgrade to managed database** - When you have more users
5. **Add custom error pages** - Better user experience
6. **Set up staging environment** - Test before production

---

## 🎉 You're Live!

Congratulations! Your Revenue Radar app is now:

- ✅ Running 24/7 on professional infrastructure
- ✅ Accessible from anywhere in the world
- ✅ Secured with HTTPS
- ✅ Automatically deploying updates from GitHub
- ✅ Backing up data every 12 hours
- ✅ Monitoring health and performance

**Share your app:**
- Send users to `https://yourdomain.com/dashboard/login.html`
- They can log in and use it immediately!

**Update from your Mac:**
- Edit code locally
- `git push`
- Live in 2 minutes!

---

## 📞 Support Resources

- **DigitalOcean Docs**: [https://docs.digitalocean.com/products/app-platform/](https://docs.digitalocean.com/products/app-platform/)
- **DigitalOcean Support**: [https://www.digitalocean.com/support](https://www.digitalocean.com/support)
- **GitHub Docs**: [https://docs.github.com/](https://docs.github.com/)

---

**Last Updated**: January 3, 2026

**Need help?** Check the troubleshooting section or contact DigitalOcean support (they're very responsive!).
