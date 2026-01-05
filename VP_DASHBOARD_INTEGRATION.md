# VP Dashboard Integration Guide

## ✅ Updated Role Access

**Customer Admin (VP/Regional Manager)** now has access to:
- 📊 **Manager Dashboard** - Main management view
- 🎯 **VP Dashboard** - Analytics/reporting (your Vite app)

This gives VPs the ability to manage operations AND view their analytics.

---

## 🔗 Integrating VP Dashboard into Production

You have **two options** for integrating your VP dashboard (currently on `localhost:5173`):

### **Option 1: Embed as Tab on Same Domain (RECOMMENDED)**

This keeps everything under one domain and makes navigation seamless.

#### Steps:

1. **Build your Vite app for production:**
   ```bash
   cd /path/to/your/vite/vp-dashboard
   npm run build
   ```

2. **Copy the build to your backend's static folder:**
   ```bash
   # Create a vp-dashboard folder in your dashboard directory
   mkdir -p /Users/taylorray/Desktop/ai-sales-backend/dashboard/vp-dashboard

   # Copy the built files
   cp -r dist/* /Users/taylorray/Desktop/ai-sales-backend/dashboard/vp-dashboard/
   ```

3. **Update the VP dashboard URL in `shared-nav.js`:**
   ```javascript
   vp: {
     name: 'VP',
     url: '/dashboard/vp-dashboard/index.html',  // Updated to local path
     icon: '🎯',
     roles: ['admin', 'customer_admin']
   },
   ```

4. **Configure your Express server** to serve the VP dashboard:

   Already done! Your server.js already serves everything in `/dashboard/` as static files.

5. **Deploy:**
   ```bash
   git add dashboard/vp-dashboard dashboard/shared-nav.js
   git commit -m "Add VP dashboard to production"
   git push
   ```

**Pros:**
- ✅ Single domain - no CORS issues
- ✅ Seamless navigation
- ✅ Easier authentication (shared localStorage)
- ✅ One deployment

**Cons:**
- ❌ VP dashboard and backend deploy together
- ❌ Need to rebuild Vite app and copy files for updates

---

### **Option 2: Separate Deployment with Authentication**

Deploy your VP dashboard separately and integrate via authentication tokens.

#### Steps:

1. **Deploy your Vite app separately** (Vercel, Netlify, DigitalOcean):
   ```bash
   cd /path/to/your/vite/vp-dashboard
   npm run build
   # Deploy to your hosting provider
   ```

2. **Update `shared-nav.js` with production URL:**
   ```javascript
   vp: {
     name: 'VP',
     url: 'https://your-vp-dashboard.vercel.app',
     icon: '🎯',
     roles: ['admin', 'customer_admin']
   },
   ```

3. **Add authentication to your VP dashboard:**

   In your Vite app's `src/main.js` or entry point:
   ```javascript
   // Check for auth token from parent window or localStorage
   const checkAuth = () => {
     const token = localStorage.getItem('accessToken');

     if (!token) {
       // Redirect to login
       window.location.href = 'https://king-prawn-app-pc8hi.ondigitalocean.app/dashboard/login.html';
       return;
     }

     // Verify token with your backend
     fetch('https://king-prawn-app-pc8hi.ondigitalocean.app/auth/me', {
       headers: {
         'Authorization': `Bearer ${token}`
       }
     })
     .then(res => {
       if (!res.ok) throw new Error('Unauthorized');
       return res.json();
     })
     .then(data => {
       // Check if user has VP access
       if (!['admin', 'customer_admin'].includes(data.data.role)) {
         alert('Access denied. VP privileges required.');
         window.location.href = 'https://king-prawn-app-pc8hi.ondigitalocean.app/dashboard/login.html';
       }
     })
     .catch(() => {
       window.location.href = 'https://king-prawn-app-pc8hi.ondigitalocean.app/dashboard/login.html';
     });
   };

   checkAuth();
   ```

4. **Configure CORS on your backend** (already done in server.js):
   ```javascript
   // Your server already allows credentials and CORS
   ```

**Pros:**
- ✅ Independent deployments
- ✅ VP dashboard can be updated separately
- ✅ Can use different tech stacks

**Cons:**
- ❌ More complex setup
- ❌ Potential CORS issues
- ❌ Need to manage authentication across domains

---

## 📋 My Recommendation

**Use Option 1 (Embed as Tab)** because:

1. Your VP dashboard is already built with Vite - just needs a production build
2. Keeps everything under one domain (simpler)
3. No CORS headaches
4. Seamless user experience
5. Easier to manage

### Quick Implementation (Option 1):

```bash
# 1. Build your Vite app
cd /path/to/your/vite/vp-dashboard
npm run build

# 2. Copy to backend
cp -r dist/* /Users/taylorray/Desktop/ai-sales-backend/dashboard/vp-dashboard/

# 3. Update shared-nav.js
# Change line 31 from:
#   url: 'http://localhost:5173/dashboard',
# To:
#   url: '/dashboard/vp-dashboard/index.html',

# 4. Commit and deploy
cd /Users/taylorray/Desktop/ai-sales-backend
git add dashboard/vp-dashboard dashboard/shared-nav.js
git commit -m "Integrate VP dashboard into production"
git push
```

Done! Your VP dashboard will be accessible as a tab for VPs and Admins.

---

## 🎯 Final Role Structure

| Role | Tabs Visible | Landing Page |
|------|-------------|--------------|
| **Admin (YOU)** | Admin, Manager, VP, Rep | Manager Dashboard |
| **Manager (GM)** | Manager, Rep | Manager Dashboard |
| **Customer Admin (VP)** | Manager, VP | Manager Dashboard |
| **Rep** | Rep only | Rep Dashboard |

---

## 🔐 Security Notes

- All dashboards require authentication
- Tabs only show for users with proper roles
- Navigation checks user role from localStorage
- Backend validates JWT tokens on all API calls
- VPs cannot access Admin (user management)
- Reps cannot access Manager, VP, or Admin dashboards

---

## 📞 Need Help?

If you want me to help you integrate your specific VP dashboard, just let me know:
1. Where your Vite VP dashboard code is located
2. Which option you prefer (Option 1 recommended)
3. Any specific features you want integrated

I can automate the entire build and integration process for you!
