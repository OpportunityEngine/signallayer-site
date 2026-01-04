# 🌐 Custom Domain Setup Guide

Complete guide to adding a custom domain to your Revenue Radar deployment.

---

## 📋 Quick Overview

**What you'll do:**
1. Buy a domain name (~$10-15/year)
2. Add it to DigitalOcean
3. Update DNS records
4. Wait 5-30 minutes for propagation
5. HTTPS is automatically configured!

**Time**: ~15 minutes (+ DNS propagation wait)

---

## 🛒 Step 1: Buy a Domain

### Recommended Registrars

#### Option 1: Namecheap (Best Value)
- **Price**: ~$9-13/year
- **Website**: [namecheap.com](https://www.namecheap.com/)
- **Pros**: Cheap, free privacy protection, easy to use

**How to buy:**
1. Go to [namecheap.com](https://www.namecheap.com/)
2. Search for your domain (e.g., "revenueradar")
3. Add `.com` or `.io` to cart
4. Checkout (enable WhoisGuard for free privacy)

#### Option 2: Google Domains
- **Price**: ~$12/year
- **Website**: [domains.google](https://domains.google/)
- **Pros**: Clean interface, privacy included

#### Option 3: Cloudflare Registrar
- **Price**: ~$9/year (at-cost pricing)
- **Website**: [cloudflare.com/products/registrar](https://www.cloudflare.com/products/registrar/)
- **Pros**: Cheapest, includes CDN

**Domain Name Ideas:**
- `revenueradar.com` - Your product name
- `yourcompany.com` - Your company name
- `yourbrand.io` - Tech-focused
- `yourbrand.app` - Modern alternative

**Avoid:**
- Complicated spellings
- Hyphens or numbers
- Trademarked names

---

## 🔗 Step 2: Add Domain to DigitalOcean

### 1. Open Your App

1. Log into [DigitalOcean](https://cloud.digitalocean.com/)
2. Go to **Apps**
3. Click your **revenue-radar** app

### 2. Add Domain

1. Click **"Settings"** tab
2. Scroll to **"Domains"** section
3. Click **"Add Domain"**

### 3. Enter Your Domain

**For root domain:**
```
yourdomain.com
```

**For www subdomain (recommended to add both):**
```
www.yourdomain.com
```

Click **"Add Domain"**

### 4. Get DNS Records

DigitalOcean will show you DNS records like:

```
Type: CNAME
Name: @
Value: revenue-radar-xxxxx.ondigitalocean.app
```

**Keep this tab open!** You'll need these values.

---

## 📝 Step 3: Configure DNS Records

Now you need to point your domain to DigitalOcean.

### For Namecheap

1. Go to [Namecheap Dashboard](https://ap.www.namecheap.com/domains/list/)
2. Click **"Manage"** next to your domain
3. Click **"Advanced DNS"** tab
4. Delete any existing A or CNAME records for `@` or `www`
5. Click **"Add New Record"**

**Add Root Domain:**
```
Type: CNAME Record
Host: @
Value: [paste from DigitalOcean]
TTL: Automatic
```

**Add WWW Subdomain:**
```
Type: CNAME Record
Host: www
Value: [paste from DigitalOcean]
TTL: Automatic
```

6. Click **"Save All Changes"**

### For Google Domains

1. Go to [Google Domains](https://domains.google.com/registrar/)
2. Click your domain
3. Click **"DNS"** in left sidebar
4. Scroll to **"Custom resource records"**

**Add Root Domain:**
```
Name: @
Type: CNAME
TTL: 1H
Data: [paste from DigitalOcean]
```

**Add WWW Subdomain:**
```
Name: www
Type: CNAME
TTL: 1H
Data: [paste from DigitalOcean]
```

5. Click **"Add"**

### For Cloudflare

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Click your domain
3. Click **"DNS"** tab
4. Click **"Add record"**

**Add Root Domain:**
```
Type: CNAME
Name: @
Target: [paste from DigitalOcean]
Proxy status: DNS only (gray cloud)
TTL: Auto
```

**Add WWW Subdomain:**
```
Type: CNAME
Name: www
Target: [paste from DigitalOcean]
Proxy status: DNS only (gray cloud)
TTL: Auto
```

5. Click **"Save"**

**Important**: Set to "DNS only" (gray cloud), not "Proxied" (orange cloud)

---

## ⏱️ Step 4: Wait for DNS Propagation

DNS changes take time to propagate globally.

**Typical wait times:**
- **Best case**: 5 minutes
- **Average**: 15-30 minutes
- **Worst case**: Up to 48 hours (rare)

### Check Propagation Status

**Method 1: Command Line**
```bash
# Mac/Linux
nslookup yourdomain.com

# Should show DigitalOcean IP eventually
```

**Method 2: Online Tool**
- Go to [dnschecker.org](https://dnschecker.org/)
- Enter your domain
- Select "CNAME" record type
- Click "Search"

**What you're looking for:**
- Green checkmarks globally
- CNAME points to DigitalOcean URL

### While You Wait...

☕ Grab coffee, DNS propagation is automated!

Don't refresh constantly - it won't speed things up.

---

## 🔒 Step 5: HTTPS Configuration (Automatic!)

**Good news**: DigitalOcean handles this automatically!

### What Happens Automatically:

1. ✅ SSL certificate generated (free from Let's Encrypt)
2. ✅ HTTPS configured on your domain
3. ✅ HTTP automatically redirects to HTTPS
4. ✅ Certificate auto-renews every 90 days

**You don't need to do anything!**

### Verify HTTPS is Working

After DNS propagates, visit:
```
https://yourdomain.com/health
```

You should see:
- 🔒 Padlock icon in browser
- Valid SSL certificate
- Healthy response from your app

---

## 🎯 Step 6: Update App Configuration

### Update ALLOWED_ORIGINS

1. Go to DigitalOcean → Your App
2. Click **"Settings"** → **"Environment Variables"**
3. Find `ALLOWED_ORIGINS`
4. Update to:
```
https://yourdomain.com,https://www.yourdomain.com
```
5. Click **"Save"** (app will restart)

### Test Your Login Page

Visit:
```
https://yourdomain.com/dashboard/login.html
```

You should:
- See the login page
- Be able to log in
- No CORS errors

✅ **Your custom domain is complete!**

---

## 📧 Step 7: Set Up Email (Optional)

If you want to send emails from your domain (e.g., `noreply@yourdomain.com`):

### Option 1: Gmail SMTP (Free, Easy)

1. Create a Gmail account
2. Enable 2FA
3. Generate App Password
4. Update environment variables:
```
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=youremail@gmail.com
SMTP_PASS=[app password]
EMAIL_FROM=youremail@gmail.com
```

### Option 2: SendGrid (Professional, Free Tier)

1. Sign up at [sendgrid.com](https://sendgrid.com/)
2. Free tier: 100 emails/day
3. Get API key
4. Configure in app

### Option 3: Custom Domain Email

**Using Namecheap:**
- Email forwarding (free)
- Private email ($1/month)

**Using Google Workspace:**
- Professional email
- $6/user/month

---

## 🎨 Customization

### Custom Branding

Update these files with your domain:

**Login Page** - [dashboard/login.html](dashboard/login.html):
```html
<div class="logo-subtitle">yourdomain.com</div>
```

**Dashboard Header** - [dashboard/manager-view.html](dashboard/manager-view.html):
```html
<div class="subtitle">yourdomain.com • Manager Dashboard</div>
```

**Email Templates** - When you set up emails:
```html
<a href="https://yourdomain.com">Visit Dashboard</a>
```

### Favicon

Add a favicon for professional branding:

1. Create a 32x32 or 64x64 PNG logo
2. Name it `favicon.ico`
3. Place in `/dashboard/` folder
4. Add to all HTML files:
```html
<link rel="icon" type="image/x-icon" href="/dashboard/favicon.ico">
```

---

## 🔧 Troubleshooting

### Domain Not Loading

**Check DNS:**
```bash
nslookup yourdomain.com
```

Should return DigitalOcean IP, not registrar's parking page.

**Common fixes:**
- Wait longer (DNS can take up to 48 hours)
- Clear browser cache
- Try incognito/private mode
- Verify CNAME records are correct

### SSL Certificate Error

**Symptoms:**
- "Your connection is not private"
- SSL certificate warning

**Fixes:**
1. Wait 5-10 minutes after DNS propagates
2. DigitalOcean needs to generate certificate
3. Check DigitalOcean → Your App → Settings → Domains
4. Should show "Certificate Active"

### CORS Errors After Domain Change

**Fix:**
1. Update `ALLOWED_ORIGINS` environment variable
2. Include both root and www:
```
https://yourdomain.com,https://www.yourdomain.com
```
3. Restart app (automatic after env var change)

### WWW Not Working

**Cause**: You only added root domain CNAME, not www

**Fix:**
1. Add another CNAME record:
```
Type: CNAME
Host: www
Value: [same as root domain]
```
2. Add domain in DigitalOcean:
```
www.yourdomain.com
```

---

## 📊 Domain Management

### Renew Your Domain

Domains expire after 1 year.

**Set auto-renewal:**
1. Go to your registrar
2. Find your domain
3. Enable auto-renewal
4. Update payment method

**Never let your domain expire** - you could lose it!

### Transfer Domain

If you want to change registrars:

1. Unlock domain (current registrar)
2. Get transfer code
3. Initiate transfer (new registrar)
4. Approve transfer email
5. DNS records transfer automatically

**Cost**: Usually another year added (~$10)

### Add Subdomains

Want `app.yourdomain.com` or `api.yourdomain.com`?

1. Add CNAME record:
```
Type: CNAME
Host: app
Value: [DigitalOcean URL]
```

2. Add in DigitalOcean:
```
app.yourdomain.com
```

---

## 🎓 Best Practices

### Security

- ✅ Enable WhoisGuard / domain privacy
- ✅ Use strong registrar password
- ✅ Enable 2FA on registrar account
- ✅ Keep domain auto-renewal on
- ✅ Keep email updated at registrar

### Performance

- ✅ Use Cloudflare for CDN (optional)
- ✅ Enable caching (already done by DigitalOcean)
- ✅ Use www or non-www consistently (pick one)

### SEO

- ✅ Use HTTPS (automatic)
- ✅ Redirect www ↔ non-www (automatic)
- ✅ Add sitemap later if needed
- ✅ Use descriptive domain name

---

## 💰 Cost Summary

| Item | Cost | Frequency |
|------|------|-----------|
| Domain registration | $9-15 | Annual |
| Domain privacy (WhoisGuard) | Free-$3 | Annual |
| SSL certificate | **FREE** | Auto-renews |
| DigitalOcean (unchanged) | $12 | Monthly |

**Total additional**: ~$10-15/year for domain

---

## ✅ Completion Checklist

- [ ] Domain purchased
- [ ] DNS CNAME records added (root + www)
- [ ] Domain added in DigitalOcean
- [ ] DNS propagated (verified with dnschecker.org)
- [ ] HTTPS working (green padlock in browser)
- [ ] `ALLOWED_ORIGINS` updated
- [ ] Login page accessible at https://yourdomain.com/dashboard/login.html
- [ ] Admin user can log in
- [ ] Auto-renewal enabled on domain

---

## 🎉 You're Done!

Your Revenue Radar app is now:
- ✅ On your custom domain
- ✅ Secured with HTTPS
- ✅ Professional and brandable
- ✅ Ready to share with customers

**Share with users:**
```
Login here: https://yourdomain.com/dashboard/login.html
```

**Make updates:**
```bash
git add .
git commit -m "Updated feature"
git push
# Live in 2 minutes!
```

---

**Last Updated**: January 3, 2026

Need help? Check [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) or contact your registrar's support.
