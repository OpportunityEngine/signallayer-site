# ⚡ Quick Start - Deploy in 30 Minutes

The fastest path from your Mac to a live website.

---

## ✅ What You Need

- [ ] GitHub account (free) - [Create here](https://github.com/join)
- [ ] DigitalOcean account - [Sign up here](https://www.digitalocean.com/)
- [ ] Your Anthropic API key
- [ ] 30 minutes

**Cost**: $12/month (+ optional $10/year for custom domain)

---

## 🚀 Step-by-Step Deployment

### 1. Push to GitHub (5 minutes)

```bash
cd /Users/taylorray/Desktop/ai-sales-backend
./scripts/setup-github.sh
```

The script will guide you through:
1. Creating a GitHub repository
2. Pushing your code
3. Setting up automatic deployment

**Manual option**: Follow [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) Step 1

---

### 2. Deploy to DigitalOcean (10 minutes)

**2.1 Create Account**
- Go to [digitalocean.com](https://www.digitalocean.com/)
- Sign up (get $200 credit for 60 days)
- Add payment method

**2.2 Create App**
1. Click "Create" → "Apps"
2. Choose "GitHub" as source
3. Select your `revenue-radar` repository
4. Select `main` branch
5. Enable "Autodeploy"
6. Click "Next"

**2.3 Configure**
1. Type: Web Service
2. Build: `npm install`
3. Run: `npm start`
4. Port: `5050`
5. Plan: Basic ($12/month)
6. Click "Next"

**2.4 Add Environment Variables**

Generate secrets first:
```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(64).toString('hex'))"
```

Add these as **encrypted** variables in DigitalOcean:
```
NODE_ENV = production
PORT = 5050
TRUST_PROXY = true
JWT_SECRET = [paste generated secret]
SESSION_SECRET = [paste generated secret]
ANTHROPIC_API_KEY = [your Anthropic key]
BCRYPT_ROUNDS = 12
DATABASE_PATH = /data/revenue-radar.db
DATABASE_BACKUP_PATH = /data/backups
DATABASE_BACKUP_ENABLED = true
WEB_SCRAPER_ENABLE = 1
OSM_ENABLE = 1
```

**2.5 Deploy**
1. Name: `revenue-radar`
2. Region: New York
3. Click "Create Resources"
4. ⏱️ Wait 5-10 minutes...

---

### 3. Create Admin User (5 minutes)

**Option A: Via Console** (Recommended)
1. DigitalOcean → Your App → Console
2. Click "Open Console"
3. Run:
```bash
node scripts/create-admin.js
```
4. Enter email, password, name

**Option B: Via Temporary Registration**
1. Edit [auth-routes.js](auth-routes.js:88)
2. Change `role: 'rep'` to `role: 'admin'`
3. Push to GitHub (auto-deploys)
4. Register at your app URL
5. Change back to `role: 'rep'`
6. Push again

---

### 4. Configure CORS (2 minutes)

1. Copy your app URL (e.g., `https://revenue-radar-xxxxx.ondigitalocean.app`)
2. DigitalOcean → Settings → Environment Variables
3. Add:
```
ALLOWED_ORIGINS = https://revenue-radar-xxxxx.ondigitalocean.app
```
4. Save (app restarts)

---

### 5. Test Your App (5 minutes)

**Health Check:**
```bash
curl https://your-app-url.ondigitalocean.app/health
```

Should return:
```json
{"status":"healthy","timestamp":"...","uptime":123.45}
```

**Login Page:**
Visit: `https://your-app-url.ondigitalocean.app/dashboard/login.html`

**Login:**
- Enter your admin credentials
- Should redirect to manager dashboard

✅ **YOU'RE LIVE!** 🎉

---

## 🌐 Add Custom Domain (Optional)

**Quick Steps:**
1. Buy domain at [namecheap.com](https://www.namecheap.com/) (~$10/year)
2. Add CNAME records pointing to your DigitalOcean URL
3. Add domain in DigitalOcean → Settings → Domains
4. Wait 15-30 minutes for DNS
5. Update `ALLOWED_ORIGINS` to your domain

**Detailed guide**: [DOMAIN_SETUP_GUIDE.md](DOMAIN_SETUP_GUIDE.md)

---

## 🔄 Making Updates

Edit code on your Mac:

```bash
# 1. Make changes in your editor

# 2. Commit and push
git add .
git commit -m "Updated dashboard"
git push

# 3. Auto-deploys in 2-3 minutes! ⚡
```

---

## 📊 Monitor Your App

**View Logs:**
DigitalOcean → Your App → Runtime Logs

**Check Metrics:**
DigitalOcean → Your App → Insights

**Health Check:**
Visit: `https://your-app-url/health`

---

## 🆘 Troubleshooting

### Build Failed
- Check DigitalOcean → Deployments → Click failed build
- Read error message
- Fix code, push again

### Can't Login
- Did you create admin user?
- Is ALLOWED_ORIGINS set correctly?
- Check browser console for errors

### App Crashing
- DigitalOcean → Runtime Logs
- Look for error messages
- Check environment variables

**Full troubleshooting**: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md#-troubleshooting)

---

## 📚 Complete Guides

- **Full Deployment**: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) - Complete step-by-step
- **Custom Domain**: [DOMAIN_SETUP_GUIDE.md](DOMAIN_SETUP_GUIDE.md) - Domain setup
- **Authentication**: [AUTHENTICATION_COMPLETE.md](AUTHENTICATION_COMPLETE.md) - User management

---

## 💰 Cost Breakdown

| Service | Cost |
|---------|------|
| DigitalOcean App | $12/month |
| Domain (optional) | $10/year |
| SSL Certificate | FREE |
| GitHub | FREE |

**Total**: ~$13/month with domain

---

## ✅ Deployment Checklist

- [ ] Code pushed to GitHub
- [ ] App deployed on DigitalOcean
- [ ] Environment variables set
- [ ] Admin user created
- [ ] ALLOWED_ORIGINS configured
- [ ] Health check passes
- [ ] Can log in successfully
- [ ] (Optional) Custom domain added

---

## 🎉 You're Done!

Your app is now:
- ✅ Running 24/7
- ✅ Accessible from anywhere
- ✅ Secured with HTTPS
- ✅ Auto-deploying from GitHub
- ✅ Backing up every 12 hours

**Share your app:**
Send users to: `https://your-app-url/dashboard/login.html`

**Make updates:**
Edit on your Mac → `git push` → Live in 2 minutes!

---

**Questions?** Check [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) or DigitalOcean's excellent support.

**Last Updated**: January 3, 2026
